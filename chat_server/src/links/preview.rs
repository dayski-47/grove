use scraper::{Html, Selector};

#[allow(dead_code)]
const TITLE_MAX_CHARS: usize = 300;
#[allow(dead_code)]
const DESCRIPTION_MAX_CHARS: usize = 500;
#[allow(dead_code)]
const IMAGE_URL_MAX_CHARS: usize = 2048;

#[derive(Debug, Default, PartialEq)]
pub struct ParsedPreview {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
}

/// Static parse only — no JS execution, matching how Slack/Discord's own
/// unfurlers work. Untrusted external content, so every extracted field is
/// length-capped before it ever reaches the database or a response body.
#[allow(dead_code)]
pub fn parse_preview_html(html: &str) -> ParsedPreview {
    let doc = Html::parse_document(html);

    let title_sel = Selector::parse("title").unwrap();
    let title = doc
        .select(&title_sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| truncate_chars(&s, TITLE_MAX_CHARS));

    let og_desc_sel = Selector::parse(r#"meta[property="og:description"]"#).unwrap();
    let desc_sel = Selector::parse(r#"meta[name="description"]"#).unwrap();
    let description = doc
        .select(&og_desc_sel)
        .next()
        .or_else(|| doc.select(&desc_sel).next())
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| truncate_chars(&s, DESCRIPTION_MAX_CHARS));

    let og_image_sel = Selector::parse(r#"meta[property="og:image"]"#).unwrap();
    let image_url = doc
        .select(&og_image_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| truncate_chars(&s, IMAGE_URL_MAX_CHARS));

    ParsedPreview {
        title,
        description,
        image_url,
    }
}

#[allow(dead_code)]
fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_title_and_prefers_og_description_over_meta_description() {
        let html = r#"
        <html><head>
            <title>  Example Page Title  </title>
            <meta name="description" content="fallback description">
            <meta property="og:description" content="OG description wins">
            <meta property="og:image" content="https://example.com/img.png">
        </head><body></body></html>
        "#;
        assert_eq!(
            parse_preview_html(html),
            ParsedPreview {
                title: Some("Example Page Title".to_string()),
                description: Some("OG description wins".to_string()),
                image_url: Some("https://example.com/img.png".to_string()),
            }
        );
    }

    #[test]
    fn falls_back_to_meta_description_without_og_tags() {
        let html = r#"<html><head><title>T</title><meta name="description" content="fallback"></head></html>"#;
        let result = parse_preview_html(html);
        assert_eq!(result.description, Some("fallback".to_string()));
    }

    #[test]
    fn handles_a_page_with_only_a_title() {
        let html = r#"<html><head><title>Just A Title</title></head></html>"#;
        assert_eq!(
            parse_preview_html(html),
            ParsedPreview {
                title: Some("Just A Title".to_string()),
                description: None,
                image_url: None,
            }
        );
    }

    #[test]
    fn returns_all_none_for_a_page_with_no_metadata() {
        let html = r#"<html><body><p>no head metadata</p></body></html>"#;
        assert_eq!(parse_preview_html(html), ParsedPreview::default());
    }

    #[test]
    fn treats_a_blank_title_as_no_title() {
        let html = r#"<html><head><title>   </title></head></html>"#;
        assert_eq!(parse_preview_html(html), ParsedPreview::default());
    }

    #[test]
    fn does_not_panic_on_malformed_html() {
        let html = r#"<title>Unterminated <meta property="og:image" content="https://x.com/a.png"#;
        // html5ever is a tolerant parser — this must not panic, whatever it extracts.
        let _ = parse_preview_html(html);
    }

    #[test]
    fn truncates_an_absurdly_long_title() {
        let long_title = "a".repeat(1000);
        let html = format!("<html><head><title>{long_title}</title></head></html>");
        let result = parse_preview_html(&html);
        assert!(result.title.unwrap().chars().count() <= 300);
    }

    #[test]
    fn truncates_an_absurdly_long_image_url() {
        let long_path = "a".repeat(5000);
        let html = format!(
            r#"<html><head><meta property="og:image" content="https://example.com/{long_path}"></head></html>"#
        );
        let result = parse_preview_html(&html);
        assert!(result.image_url.unwrap().chars().count() <= 2048);
    }
}
