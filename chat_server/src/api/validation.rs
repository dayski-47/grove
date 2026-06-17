use axum::http::StatusCode;

pub fn validate_username(username: &str) -> Result<(), (StatusCode, String)> {
    if username.len() < 3 || username.len() > 32 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Username must be 3–32 characters".to_string(),
        ));
    }
    if !username.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err((
            StatusCode::BAD_REQUEST,
            "Username: letters, numbers, underscores only".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_email(email: &str) -> Result<(), (StatusCode, String)> {
    if email.len() > 255 {
        return Err((StatusCode::BAD_REQUEST, "Email too long".to_string()));
    }
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 || parts[0].is_empty() || !parts[1].contains('.') {
        return Err((StatusCode::BAD_REQUEST, "Invalid email address".to_string()));
    }
    Ok(())
}

pub fn validate_password(password: &str) -> Result<(), (StatusCode, String)> {
    if password.len() < 8 || password.len() > 128 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Password must be 8–128 characters".to_string(),
        ));
    }
    if !password.chars().any(|c| c.is_numeric()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Password must contain a number".to_string(),
        ));
    }
    if !password.chars().any(|c| c.is_alphabetic()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Password must contain a letter".to_string(),
        ));
    }
    if !password.chars().any(|c| !c.is_alphanumeric()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Password must contain a special character".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_message_text(text: &str) -> Result<(), &'static str> {
    if text.is_empty() {
        return Err("Message cannot be empty");
    }
    if text.len() > 2000 {
        return Err("Message too long");
    }
    Ok(())
}

pub fn validate_channel_name(name: &str) -> Result<(), (StatusCode, String)> {
    if name.is_empty() || name.len() > 100 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Channel name must be 1–100 characters".to_string(),
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == ' ')
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Channel name contains invalid characters".to_string(),
        ));
    }
    Ok(())
}
