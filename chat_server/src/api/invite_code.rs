use rand::Rng;

#[allow(dead_code)]
const CODE_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
#[allow(dead_code)]
const CODE_LEN: usize = 10;

/// Generates a random, URL-safe invite code (10 alphanumeric characters).
pub fn generate_invite_code() -> String {
    let mut rng = rand::rng();
    (0..CODE_LEN)
        .map(|_| {
            let idx = rng.random_range(0..CODE_CHARS.len());
            CODE_CHARS[idx] as char
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_a_code_of_the_expected_length() {
        let code = generate_invite_code();
        assert_eq!(code.len(), CODE_LEN);
    }

    #[test]
    fn generates_only_alphanumeric_characters() {
        let code = generate_invite_code();
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn generates_different_codes_across_calls() {
        let a = generate_invite_code();
        let b = generate_invite_code();
        // Not a strict guarantee, but a collision here (10 chars, 62-symbol
        // alphabet, 2 samples) is astronomically unlikely and would indicate
        // a broken RNG rather than bad luck.
        assert_ne!(a, b);
    }
}
