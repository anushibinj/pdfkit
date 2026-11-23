//! Groups content-stream tokens into operations: operands, then operator.

use std::ops::Range;

use super::lexer::{tokenize, LexError, Token, TokenKind};

/// Deepest nesting of arrays and dictionaries accepted in an operand.
const MAX_DEPTH: usize = 64;

/// An operand value.
#[derive(Debug, Clone, PartialEq)]
pub enum Operand {
    Number(f64),
    Name(Vec<u8>),
    String(Vec<u8>),
    Array(Vec<Operand>),
    Dict(Vec<(Vec<u8>, Operand)>),
    /// `true`, `false`, `null` (or a stray keyword inside an array).
    Keyword(Vec<u8>),
}

impl Operand {
    /// The number, if this is one.
    pub fn as_number(&self) -> Option<f64> {
        match self {
            Operand::Number(n) => Some(*n),
            _ => None,
        }
    }

    /// The name, if this is one.
    pub fn as_name(&self) -> Option<&[u8]> {
        match self {
            Operand::Name(n) => Some(n),
            _ => None,
        }
    }
}

/// One operation and where it sits in the source.
#[derive(Debug, Clone, PartialEq)]
pub struct Operation {
    /// The operator, e.g. `Tj`. Inline images use `BI`.
    pub operator: Vec<u8>,
    pub operands: Vec<Operand>,
    /// The byte range of each operand.
    pub operand_spans: Vec<Range<usize>>,
    /// From the first operand (or the operator) to the end of the operator.
    pub span: Range<usize>,
}

impl Operation {
    /// The operands as numbers, if there are exactly `count` and all are
    /// numbers.
    pub fn numbers(&self, count: usize) -> Option<Vec<f64>> {
        if self.operands.len() != count {
            return None;
        }
        self.operands.iter().map(Operand::as_number).collect()
    }
}

/// Parse a content stream into operations.
///
/// Operands left over at the end (with no operator after them) belong to no
/// operation; they are simply not returned, and stay in the stream as they
/// are, since only returned spans are ever rewritten.
///
/// # Errors
///
/// A [`LexError`] when the stream cannot be tokenised or its brackets do
/// not balance.
pub fn parse_operations(src: &[u8]) -> Result<Vec<Operation>, LexError> {
    let tokens = tokenize(src)?;
    let mut operations = Vec::new();
    let mut operands: Vec<(Operand, Range<usize>)> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let token = &tokens[i];
        match &token.kind {
            TokenKind::InlineImage { .. } => {
                operands.clear();
                operations.push(Operation {
                    operator: b"BI".to_vec(),
                    operands: Vec::new(),
                    operand_spans: Vec::new(),
                    span: token.span.clone(),
                });
                i += 1;
            }
            TokenKind::Keyword(word) if !is_value_keyword(word) => {
                let start = operands.first().map_or(token.span.start, |(_, s)| s.start);
                let (values, spans) = operands.drain(..).unzip();
                operations.push(Operation {
                    operator: word.clone(),
                    operands: values,
                    operand_spans: spans,
                    span: start..token.span.end,
                });
                i += 1;
            }
            _ => {
                let start = token.span.start;
                let value = parse_value(&tokens, &mut i, 0)?;
                let end = tokens[i - 1].span.end;
                operands.push((value, start..end));
            }
        }
    }
    Ok(operations)
}

/// Keywords that are values (operands), not operators.
fn is_value_keyword(word: &[u8]) -> bool {
    matches!(word, b"true" | b"false" | b"null")
}

/// Parse one operand starting at `tokens[*i]`, advancing `i` past it.
fn parse_value(tokens: &[Token], i: &mut usize, depth: usize) -> Result<Operand, LexError> {
    let token = &tokens[*i];
    let error = |reason| LexError {
        at: token.span.start,
        reason,
    };
    if depth > MAX_DEPTH {
        return Err(error("operand nested too deeply"));
    }
    *i += 1;
    match &token.kind {
        TokenKind::Number(n) => Ok(Operand::Number(*n)),
        TokenKind::Name(n) => Ok(Operand::Name(n.clone())),
        TokenKind::String(s) => Ok(Operand::String(s.clone())),
        TokenKind::Keyword(k) => Ok(Operand::Keyword(k.clone())),
        TokenKind::ArrayStart => {
            let mut items = Vec::new();
            loop {
                match tokens.get(*i).map(|t| &t.kind) {
                    None => return Err(error("unterminated array")),
                    Some(TokenKind::ArrayEnd) => {
                        *i += 1;
                        return Ok(Operand::Array(items));
                    }
                    Some(_) => items.push(parse_value(tokens, i, depth + 1)?),
                }
            }
        }
        TokenKind::DictStart => {
            let mut entries = Vec::new();
            loop {
                match tokens.get(*i).map(|t| &t.kind) {
                    None => return Err(error("unterminated dictionary")),
                    Some(TokenKind::DictEnd) => {
                        *i += 1;
                        return Ok(Operand::Dict(entries));
                    }
                    Some(TokenKind::Name(key)) => {
                        let key = key.clone();
                        *i += 1;
                        if tokens.get(*i).is_none() {
                            return Err(error("dictionary key without value"));
                        }
                        entries.push((key, parse_value(tokens, i, depth + 1)?));
                    }
                    Some(_) => return Err(error("dictionary key is not a name")),
                }
            }
        }
        TokenKind::ArrayEnd | TokenKind::DictEnd => Err(error("unbalanced closing bracket")),
        TokenKind::InlineImage { .. } => Err(error("inline image inside an operand")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_operations_groups_operands_with_their_operator() {
        let src = b"q 1 0 0 1 5 5 cm /F1 12 Tf [(a) 3 (b)] TJ Q";
        let ops = parse_operations(src).unwrap();
        let names: Vec<&[u8]> = ops.iter().map(|o| o.operator.as_slice()).collect();
        assert_eq!(names, [&b"q"[..], b"cm", b"Tf", b"TJ", b"Q"]);
        assert_eq!(ops[1].numbers(6), Some(vec![1.0, 0.0, 0.0, 1.0, 5.0, 5.0]));
        assert_eq!(&src[ops[2].span.clone()], b"/F1 12 Tf");
        assert_eq!(&src[ops[3].operand_spans[0].clone()], b"[(a) 3 (b)]");
        assert_eq!(
            ops[3].operands[0],
            Operand::Array(vec![
                Operand::String(b"a".to_vec()),
                Operand::Number(3.0),
                Operand::String(b"b".to_vec()),
            ])
        );
    }

    #[test]
    fn parse_operations_reads_dictionary_operands() {
        let ops = parse_operations(b"/P <</MCID 3 /Alt (x)>> BDC EMC").unwrap();
        assert_eq!(
            ops[0].operands[1],
            Operand::Dict(vec![
                (b"MCID".to_vec(), Operand::Number(3.0)),
                (b"Alt".to_vec(), Operand::String(b"x".to_vec())),
            ])
        );
    }

    #[test]
    fn parse_operations_treats_true_false_null_as_values() {
        let ops = parse_operations(b"true false null X").unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].operands.len(), 3);
    }

    #[test]
    fn parse_operations_returns_inline_images_as_bi() {
        let ops = parse_operations(b"q BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 EI Q").unwrap();
        assert_eq!(ops[1].operator, b"BI");
        assert!(ops[1].operands.is_empty());
        assert_eq!(ops[2].operator, b"Q");
    }

    #[test]
    fn parse_operations_drops_trailing_operands() {
        let ops = parse_operations(b"q 1 2 3").unwrap();
        assert_eq!(ops.len(), 1);
    }

    #[test]
    fn parse_operations_rejects_unbalanced_brackets() {
        assert!(parse_operations(b"[1 2 TJ").is_err());
        assert!(parse_operations(b"1 ] TJ").is_err());
        assert!(parse_operations(b"<</A>> BDC").is_err());
        assert!(parse_operations(b"<<1 2>> BDC").is_err());
    }

    #[test]
    fn parse_operations_rejects_absurd_nesting() {
        let mut src = vec![b'['; 100];
        src.extend(vec![b']'; 100]);
        src.extend(b" TJ");
        assert!(parse_operations(&src).is_err());
    }

    #[test]
    fn numbers_needs_exact_count_of_numbers() {
        let ops = parse_operations(b"1 2 Td /F 2 Td 1 Td").unwrap();
        assert_eq!(ops[0].numbers(2), Some(vec![1.0, 2.0]));
        assert_eq!(ops[1].numbers(2), None);
        assert_eq!(ops[2].numbers(2), None);
    }

    #[test]
    fn operand_accessors() {
        assert_eq!(Operand::Number(2.0).as_number(), Some(2.0));
        assert_eq!(Operand::Name(b"F1".to_vec()).as_name(), Some(&b"F1"[..]));
        assert_eq!(Operand::Name(b"F1".to_vec()).as_number(), None);
        assert_eq!(Operand::Number(1.0).as_name(), None);
    }

    #[test]
    fn is_value_keyword_matches_only_values() {
        assert!(is_value_keyword(b"null"));
        assert!(!is_value_keyword(b"Tj"));
    }
}
