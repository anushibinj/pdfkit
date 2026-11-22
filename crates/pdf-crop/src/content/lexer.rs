//! Splits a content stream into tokens, remembering where each one is.
//!
//! The crop rewrites content streams by replacing a few byte ranges and
//! copying everything else verbatim, so every token carries its exact span
//! in the source. Nothing is ever re-serialised from a parsed form; that is
//! what keeps untouched content byte-for-byte identical.
//!
//! Inline images (`BI ... ID <binary> EI`) are returned as one token: their
//! binary data could otherwise be misread as operators.

use std::ops::Range;

/// What a token is. Strings and names are decoded (escapes resolved).
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    /// An integer or real number.
    Number(f64),
    /// `/Name`, without the slash.
    Name(Vec<u8>),
    /// `(literal)` or `<hex>` string, as bytes.
    String(Vec<u8>),
    /// `[`
    ArrayStart,
    /// `]`
    ArrayEnd,
    /// `<<`
    DictStart,
    /// `>>`
    DictEnd,
    /// Anything else: operators, `true`, `false`, `null`, `{`, `}`.
    Keyword(Vec<u8>),
    /// A whole inline image; `params` are the tokens between `BI` and `ID`.
    InlineImage { params: Vec<Token> },
}

/// A token and the byte range it occupies in the source.
#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Range<usize>,
}

/// The stream cannot be tokenised reliably (e.g. an unterminated string).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexError {
    /// Byte offset where the problem was found.
    pub at: usize,
    /// What went wrong.
    pub reason: &'static str,
}

/// PDF white-space characters (ISO 32000-1, table 1).
pub fn is_whitespace(byte: u8) -> bool {
    matches!(byte, b'\0' | b'\t' | b'\n' | b'\x0C' | b'\r' | b' ')
}

/// PDF delimiter characters (ISO 32000-1, table 2).
pub fn is_delimiter(byte: u8) -> bool {
    matches!(
        byte,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

/// A "regular" character: part of a name, number or keyword.
fn is_regular(byte: u8) -> bool {
    !is_whitespace(byte) && !is_delimiter(byte)
}

/// Tokenise a whole content stream.
///
/// # Errors
///
/// A [`LexError`] for input a reader could interpret in more than one way
/// (unterminated strings, a stray `)` or `>`, an inline image whose end
/// cannot be found). The caller then leaves the stream untouched.
pub fn tokenize(src: &[u8]) -> Result<Vec<Token>, LexError> {
    let mut lexer = Lexer { src, pos: 0 };
    let mut tokens = Vec::new();
    while let Some(token) = lexer.next_token()? {
        if token.kind == TokenKind::Keyword(b"BI".to_vec()) {
            tokens.push(lexer.inline_image(token.span.start)?);
        } else {
            tokens.push(token);
        }
    }
    Ok(tokens)
}

/// A cursor over the source bytes.
struct Lexer<'a> {
    src: &'a [u8],
    pos: usize,
}

impl Lexer<'_> {
    /// Skip white space and `%` comments (which run to the end of the line).
    fn skip_space(&mut self) {
        while let Some(&byte) = self.src.get(self.pos) {
            if is_whitespace(byte) {
                self.pos += 1;
            } else if byte == b'%' {
                while let Some(&b) = self.src.get(self.pos) {
                    if b == b'\n' || b == b'\r' {
                        break;
                    }
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
    }

    /// Read the next token, or `None` at the end.
    fn next_token(&mut self) -> Result<Option<Token>, LexError> {
        self.skip_space();
        let start = self.pos;
        let Some(&byte) = self.src.get(start) else {
            return Ok(None);
        };
        let kind = match byte {
            b'(' => TokenKind::String(self.literal_string()?),
            b'<' if self.src.get(start + 1) == Some(&b'<') => {
                self.pos += 2;
                TokenKind::DictStart
            }
            b'<' => TokenKind::String(self.hex_string()?),
            b'>' if self.src.get(start + 1) == Some(&b'>') => {
                self.pos += 2;
                TokenKind::DictEnd
            }
            b'[' => {
                self.pos += 1;
                TokenKind::ArrayStart
            }
            b']' => {
                self.pos += 1;
                TokenKind::ArrayEnd
            }
            b'{' | b'}' => {
                self.pos += 1;
                TokenKind::Keyword(vec![byte])
            }
            b'/' => {
                self.pos += 1;
                TokenKind::Name(self.name_body())
            }
            b')' | b'>' => return Err(self.error("unexpected closing delimiter")),
            _ => {
                let word = self.regular_run();
                if matches!(word.first(), Some(b'0'..=b'9' | b'+' | b'-' | b'.')) {
                    TokenKind::Number(parse_number(word))
                } else {
                    TokenKind::Keyword(word.to_vec())
                }
            }
        };
        Ok(Some(Token {
            kind,
            span: start..self.pos,
        }))
    }

    /// The run of regular characters starting at the cursor.
    fn regular_run(&mut self) -> &[u8] {
        let start = self.pos;
        while self.src.get(self.pos).is_some_and(|&b| is_regular(b)) {
            self.pos += 1;
        }
        &self.src[start..self.pos]
    }

    /// A name's characters after the `/`, with `#xx` escapes decoded.
    fn name_body(&mut self) -> Vec<u8> {
        let raw = self.regular_run();
        let mut name = Vec::with_capacity(raw.len());
        let mut i = 0;
        while i < raw.len() {
            if raw[i] == b'#' && i + 2 < raw.len() {
                if let (Some(hi), Some(lo)) = (hex_value(raw[i + 1]), hex_value(raw[i + 2])) {
                    name.push(hi << 4 | lo);
                    i += 3;
                    continue;
                }
            }
            name.push(raw[i]);
            i += 1;
        }
        name
    }

    /// A `( ... )` string with nested parentheses and escapes resolved.
    ///
    /// Rules (ISO 32000-1, 7.3.4.2): balanced parentheses need no escape;
    /// `\n \r \t \b \f \( \) \\` and `\ddd` (one to three octal digits) are
    /// escapes; a backslash before an end-of-line joins the lines; any
    /// other escaped character stands for itself; an unescaped CR or CR LF
    /// reads as LF.
    fn literal_string(&mut self) -> Result<Vec<u8>, LexError> {
        let open = self.pos;
        self.pos += 1;
        let mut depth = 1usize;
        let mut out = Vec::new();
        loop {
            let Some(&byte) = self.src.get(self.pos) else {
                self.pos = open;
                return Err(self.error("unterminated string"));
            };
            self.pos += 1;
            match byte {
                b'(' => {
                    depth += 1;
                    out.push(byte);
                }
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(out);
                    }
                    out.push(byte);
                }
                b'\\' => self.escape(&mut out),
                b'\r' => {
                    if self.src.get(self.pos) == Some(&b'\n') {
                        self.pos += 1;
                    }
                    out.push(b'\n');
                }
                _ => out.push(byte),
            }
        }
    }

    /// Resolve the escape after a backslash inside a literal string.
    fn escape(&mut self, out: &mut Vec<u8>) {
        let Some(&next) = self.src.get(self.pos) else {
            return;
        };
        self.pos += 1;
        match next {
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'b' => out.push(0x08),
            b'f' => out.push(0x0C),
            b'0'..=b'7' => {
                let mut value = u32::from(next - b'0');
                for _ in 0..2 {
                    match self.src.get(self.pos) {
                        Some(&d @ b'0'..=b'7') => {
                            value = value * 8 + u32::from(d - b'0');
                            self.pos += 1;
                        }
                        _ => break,
                    }
                }
                // Values above \377 overflow a byte; PDF says the high bit
                // is ignored, i.e. keep the low 8 bits.
                out.push((value & 0xFF) as u8);
            }
            b'\r' => {
                if self.src.get(self.pos) == Some(&b'\n') {
                    self.pos += 1;
                }
            }
            b'\n' => {}
            other => out.push(other),
        }
    }

    /// A `< ... >` string of hex digits (white space ignored; an odd final
    /// digit is padded with 0, as the standard says).
    fn hex_string(&mut self) -> Result<Vec<u8>, LexError> {
        let open = self.pos;
        self.pos += 1;
        let mut out = Vec::new();
        let mut high: Option<u8> = None;
        loop {
            let Some(&byte) = self.src.get(self.pos) else {
                self.pos = open;
                return Err(self.error("unterminated hex string"));
            };
            self.pos += 1;
            if byte == b'>' {
                if let Some(h) = high {
                    out.push(h << 4);
                }
                return Ok(out);
            }
            if is_whitespace(byte) {
                continue;
            }
            let Some(value) = hex_value(byte) else {
                self.pos -= 1;
                return Err(self.error("invalid character in hex string"));
            };
            match high.take() {
                Some(h) => out.push(h << 4 | value),
                None => high = Some(value),
            }
        }
    }

    /// Read an inline image after its `BI` keyword, up to and including
    /// `EI`, and return it as one token.
    ///
    /// The parameters (between `BI` and `ID`) are ordinary tokens. The
    /// image data after `ID` is binary, and PDF before 2.0 does not say how
    /// long it is, so the end is found in this order:
    /// 1. an explicit `/L` or `/Length` (PDF 2.0), if `EI` follows it;
    /// 2. the exact size of uncompressed data computed from the width,
    ///    height, bits per component and colour space, if `EI` follows it;
    /// 3. the first `EI` that stands alone (white space before it, white
    ///    space or the end after it) and is followed by text that looks
    ///    like content rather than binary data (see [`looks_like_content`]).
    fn inline_image(&mut self, start: usize) -> Result<Token, LexError> {
        let mut params = Vec::new();
        loop {
            let Some(token) = self.next_token()? else {
                return Err(self.error("inline image without ID"));
            };
            if token.kind == TokenKind::Keyword(b"ID".to_vec()) {
                break;
            }
            params.push(token);
        }
        // Exactly one white-space byte separates ID from the data.
        if self.src.get(self.pos).is_some_and(|&b| is_whitespace(b)) {
            self.pos += 1;
        }
        let data_start = self.pos;
        let known_lengths = [declared_length(&params), raw_image_length(&params)];
        for length in known_lengths.into_iter().flatten() {
            if let Some(end) = self.ei_after(data_start.saturating_add(length)) {
                self.pos = end;
                return Ok(Token {
                    kind: TokenKind::InlineImage { params },
                    span: start..end,
                });
            }
        }
        let mut at = data_start;
        while let Some(found) = find(self.src, b"EI", at) {
            let before_ok = found == data_start || is_whitespace(self.src[found - 1]);
            let end = found + 2;
            let after_ok = self.src.get(end).is_none_or(|&b| is_whitespace(b));
            if before_ok && after_ok && looks_like_content(&self.src[end..]) {
                self.pos = end;
                return Ok(Token {
                    kind: TokenKind::InlineImage { params },
                    span: start..end,
                });
            }
            at = found + 1;
        }
        self.pos = start;
        Err(self.error("inline image without a recognisable end"))
    }

    /// If `EI` follows offset `at` (after optional white space) and stands
    /// alone, the offset just past it.
    fn ei_after(&self, at: usize) -> Option<usize> {
        let mut i = at;
        while self.src.get(i).is_some_and(|&b| is_whitespace(b)) {
            i += 1;
        }
        let end = i.checked_add(2)?;
        (self.src.get(i..end) == Some(b"EI") && self.src.get(end).is_none_or(|&b| is_whitespace(b)))
            .then_some(end)
    }

    /// An error at the cursor.
    fn error(&self, reason: &'static str) -> LexError {
        LexError {
            at: self.pos,
            reason,
        }
    }
}

/// Parse a number the way PDF readers do: optional sign, digits, at most
/// one point. Readers are lenient with malformed numbers (`1.2.3`, `--4`),
/// reading the longest valid prefix and 0 if there is none, and the crop
/// must group operands exactly as a reader does, so it is lenient too.
pub fn parse_number(word: &[u8]) -> f64 {
    let mut end = 0;
    if matches!(word.first(), Some(b'+' | b'-')) {
        end = 1;
    }
    let mut seen_point = false;
    while let Some(&b) = word.get(end) {
        match b {
            b'0'..=b'9' => end += 1,
            b'.' if !seen_point => {
                seen_point = true;
                end += 1;
            }
            _ => break,
        }
    }
    let text = std::str::from_utf8(&word[..end]).unwrap_or("0");
    let text = match text {
        "" | "+" | "-" | "." | "+." | "-." => "0",
        t => t,
    };
    // A trailing point ("4.") is valid PDF; Rust's parser accepts it too.
    text.parse::<f64>().unwrap_or(0.0)
}

/// The value of one hex digit.
fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// First occurrence of `needle` in `haystack` at or after `from`.
fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|i| i + from)
}

/// Whether the bytes after a candidate `EI` look like content-stream text.
///
/// Image data is usually binary; operators and operands are printable
/// ASCII. So a candidate is accepted when the next 64 bytes (or all that
/// remain) contain no control bytes other than white space. This is the
/// same idea readers use to disambiguate inline image ends.
pub fn looks_like_content(rest: &[u8]) -> bool {
    rest.iter()
        .take(64)
        .all(|&b| is_whitespace(b) || (0x20..0x7F).contains(&b))
}

/// The inline image parameter `key` (either spelling), if present.
fn param<'t>(params: &'t [Token], keys: &[&[u8]]) -> Option<&'t TokenKind> {
    params.chunks(2).find_map(|pair| match pair {
        [Token {
            kind: TokenKind::Name(k),
            ..
        }, value]
            if keys.contains(&k.as_slice()) =>
        {
            Some(&value.kind)
        }
        _ => None,
    })
}

/// A non-negative whole number parameter.
fn number_param(params: &[Token], keys: &[&[u8]]) -> Option<usize> {
    match param(params, keys)? {
        TokenKind::Number(n) if *n >= 0.0 && n.fract() == 0.0 && *n < 1e9 => Some(*n as usize),
        _ => None,
    }
}

/// The data length declared with `/L` or `/Length` (PDF 2.0).
fn declared_length(params: &[Token]) -> Option<usize> {
    number_param(params, &[b"L", b"Length"])
}

/// The data length of an uncompressed inline image, when it can be worked
/// out from its parameters.
///
/// Rows are padded to whole bytes, so the size is
/// `height * ceil(width * bitsPerComponent * components / 8)`.
/// Compressed images (any `/F` or `/Filter`) and images whose colour space
/// is a named resource give `None`: their length is not knowable here.
fn raw_image_length(params: &[Token]) -> Option<usize> {
    if param(params, &[b"F", b"Filter"]).is_some() {
        return None;
    }
    let width = number_param(params, &[b"W", b"Width"])?;
    let height = number_param(params, &[b"H", b"Height"])?;
    let is_mask = matches!(
        param(params, &[b"IM", b"ImageMask"]),
        Some(TokenKind::Keyword(k)) if k == b"true"
    );
    let (bits, components) = if is_mask {
        (1, 1)
    } else {
        let bits = number_param(params, &[b"BPC", b"BitsPerComponent"])?;
        let components = match param(params, &[b"CS", b"ColorSpace"])? {
            TokenKind::Name(n) => match n.as_slice() {
                b"G" | b"DeviceGray" | b"I" | b"Indexed" => 1,
                b"RGB" | b"DeviceRGB" => 3,
                b"CMYK" | b"DeviceCMYK" => 4,
                _ => return None,
            },
            // An indexed colour space array: one index per pixel.
            TokenKind::ArrayStart => {
                let after = params.iter().position(
                    |t| matches!(&t.kind, TokenKind::Name(k) if k == b"CS" || k == b"ColorSpace"),
                )?;
                match params.get(after + 2).map(|t| &t.kind) {
                    Some(TokenKind::Name(n)) if n == b"I" || n == b"Indexed" => 1,
                    _ => return None,
                }
            }
            _ => return None,
        };
        (bits, components)
    };
    let row_bits = width.checked_mul(bits)?.checked_mul(components)?;
    height.checked_mul(row_bits.div_ceil(8))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &[u8]) -> Vec<TokenKind> {
        tokenize(src).unwrap().into_iter().map(|t| t.kind).collect()
    }

    fn kw(word: &str) -> TokenKind {
        TokenKind::Keyword(word.as_bytes().to_vec())
    }

    #[test]
    fn is_whitespace_matches_pdf_table() {
        for b in [0u8, 9, 10, 12, 13, 32] {
            assert!(is_whitespace(b));
        }
        assert!(!is_whitespace(b'a'));
    }

    #[test]
    fn is_delimiter_matches_pdf_table() {
        for b in b"()<>[]{}/%" {
            assert!(is_delimiter(*b));
        }
        assert!(!is_delimiter(b'q'));
    }

    #[test]
    fn tokenize_reads_operators_and_operands_with_spans() {
        let tokens = tokenize(b"q 1 0 0 1 10.5 -2 cm").unwrap();
        assert_eq!(tokens.len(), 8);
        assert_eq!(tokens[0].kind, kw("q"));
        assert_eq!(tokens[5].kind, TokenKind::Number(10.5));
        assert_eq!(tokens[7].kind, kw("cm"));
        assert_eq!(tokens[7].span, 18..20);
    }

    #[test]
    fn tokenize_skips_comments() {
        assert_eq!(kinds(b"q % a comment ) (\nQ"), vec![kw("q"), kw("Q")]);
    }

    #[test]
    fn tokenize_handles_delimiters_without_spaces() {
        assert_eq!(
            kinds(b"BT/F1 12 Tf[(a)-50(b)]TJ<<>>"),
            vec![
                kw("BT"),
                TokenKind::Name(b"F1".to_vec()),
                TokenKind::Number(12.0),
                kw("Tf"),
                TokenKind::ArrayStart,
                TokenKind::String(b"a".to_vec()),
                TokenKind::Number(-50.0),
                TokenKind::String(b"b".to_vec()),
                TokenKind::ArrayEnd,
                kw("TJ"),
                TokenKind::DictStart,
                TokenKind::DictEnd,
            ]
        );
    }

    #[test]
    fn tokenize_rejects_stray_closers_and_unterminated_strings() {
        assert!(tokenize(b"q ) Q").is_err());
        assert!(tokenize(b"(abc").is_err());
        assert!(tokenize(b"<414").is_err());
        assert!(tokenize(b"<41zz>").is_err());
        assert!(tokenize(b"1 > 2").is_err());
    }

    #[test]
    fn literal_strings_resolve_escapes_and_nesting() {
        assert_eq!(
            kinds(b"(a(b)c\\)\\n\\101\\7\\\\)"),
            vec![TokenKind::String(b"a(b)c)\nA\x07\\".to_vec())]
        );
        // Line continuation, CR LF normalisation, unknown escape.
        assert_eq!(
            kinds(b"(x\\\ny\r\nz\\q)"),
            vec![TokenKind::String(b"xy\nzq".to_vec())]
        );
        // Octal above 255 keeps the low byte.
        assert_eq!(kinds(b"(\\777)"), vec![TokenKind::String(vec![0xFF])]);
    }

    #[test]
    fn hex_strings_ignore_space_and_pad_odd_digits() {
        assert_eq!(
            kinds(b"<41 42\n4>"),
            vec![TokenKind::String(vec![0x41, 0x42, 0x40])]
        );
        assert_eq!(kinds(b"<>"), vec![TokenKind::String(vec![])]);
    }

    #[test]
    fn names_decode_hex_escapes() {
        assert_eq!(
            kinds(b"/A#20B /C#"),
            vec![
                TokenKind::Name(b"A B".to_vec()),
                TokenKind::Name(b"C#".to_vec()),
            ]
        );
    }

    #[test]
    fn parse_number_is_lenient_like_readers() {
        assert_eq!(parse_number(b"42"), 42.0);
        assert_eq!(parse_number(b"-3.5"), -3.5);
        assert_eq!(parse_number(b".5"), 0.5);
        assert_eq!(parse_number(b"4."), 4.0);
        assert_eq!(parse_number(b"+7"), 7.0);
        assert_eq!(parse_number(b"1.2.3"), 1.2);
        assert_eq!(parse_number(b"--4"), 0.0);
        assert_eq!(parse_number(b"-"), 0.0);
    }

    #[test]
    fn inline_image_with_known_raw_size_is_one_token() {
        // 2x1 RGB, 8 bits: 6 data bytes, one of which spells "EI".
        let src = b"q BI /W 2 /H 1 /BPC 8 /CS /RGB ID E\x00EI \x01 EI Q";
        let tokens = tokenize(src).unwrap();
        assert_eq!(tokens.len(), 3);
        assert!(matches!(tokens[1].kind, TokenKind::InlineImage { .. }));
        assert_eq!(&src[tokens[1].span.clone()][..2], b"BI");
        assert!(src[tokens[1].span.clone()].ends_with(b"EI"));
        assert_eq!(tokens[2].kind, kw("Q"));
    }

    #[test]
    fn inline_image_with_declared_length() {
        let src = b"BI /W 1 /H 1 /F /AHx /L 4 ID EI\x00\x00 EI Q";
        let tokens = tokenize(src).unwrap();
        assert_eq!(tokens[0].span, 0..src.len() - 2);
    }

    #[test]
    fn inline_image_end_found_by_heuristic_for_compressed_data() {
        let src = b"BI /W 4 /H 4 /F /Fl /CS /G /BPC 8 ID \x78\x9c\x01EI\x02 more\nEI Q 1 0 0 RG";
        let tokens = tokenize(src).unwrap();
        // The binary "EI" is not followed by text, the real one is.
        assert_eq!(tokens.len(), 6);
        assert_eq!(tokens[1].kind, kw("Q"));
    }

    #[test]
    fn inline_image_with_indexed_array_colour_space() {
        let src = b"BI /W 3 /H 1 /BPC 8 /CS [/I /RGB 1 <000000FFFFFF>] ID EI\x00\x01 EI Q";
        let tokens = tokenize(src).unwrap();
        assert_eq!(tokens.len(), 2);
    }

    #[test]
    fn inline_image_without_end_is_an_error() {
        assert!(tokenize(b"BI /W 1 /H 1 ID \x00\x01\x02").is_err());
        assert!(tokenize(b"BI /W 1 /H 1").is_err());
    }

    #[test]
    fn looks_like_content_rejects_binary() {
        assert!(looks_like_content(b" Q 1 0 0 rg\n"));
        assert!(looks_like_content(b""));
        assert!(!looks_like_content(b" \x01\x02"));
    }

    #[test]
    fn hex_value_reads_both_cases() {
        assert_eq!(hex_value(b'a'), Some(10));
        assert_eq!(hex_value(b'F'), Some(15));
        assert_eq!(hex_value(b'g'), None);
    }

    #[test]
    fn find_searches_from_offset() {
        assert_eq!(find(b"EI xx EI", b"EI", 1), Some(6));
        assert_eq!(find(b"abc", b"EI", 0), None);
        assert_eq!(find(b"abc", b"EI", 10), None);
    }

    #[test]
    fn raw_image_length_computes_padded_rows() {
        let params = tokenize(b"/W 3 /H 2 /BPC 1 /CS /G").unwrap();
        assert_eq!(raw_image_length(&params), Some(2)); // 3 bits -> 1 byte per row
        let params = tokenize(b"/W 3 /H 2 /IM true").unwrap();
        assert_eq!(raw_image_length(&params), Some(2));
        let params = tokenize(b"/W 3 /H 2 /BPC 8 /CS /CMYK").unwrap();
        assert_eq!(raw_image_length(&params), Some(24));
        let params = tokenize(b"/W 3 /H 2 /BPC 8 /CS /Cs1").unwrap();
        assert_eq!(raw_image_length(&params), None);
        let params = tokenize(b"/W 3 /H 2 /BPC 8 /CS /G /F /DCT").unwrap();
        assert_eq!(raw_image_length(&params), None);
    }

    #[test]
    fn declared_length_reads_either_key() {
        assert_eq!(declared_length(&tokenize(b"/L 10").unwrap()), Some(10));
        assert_eq!(declared_length(&tokenize(b"/Length 3").unwrap()), Some(3));
        assert_eq!(declared_length(&tokenize(b"/W 3").unwrap()), None);
    }

    #[test]
    fn param_and_number_param_read_pairs() {
        let params = tokenize(b"/W 3 /IM true /H -1").unwrap();
        assert_eq!(param(&params, &[b"IM"]), Some(&kw("true")));
        assert_eq!(number_param(&params, &[b"W"]), Some(3));
        assert_eq!(number_param(&params, &[b"H"]), None);
    }
}
