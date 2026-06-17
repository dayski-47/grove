#![allow(non_snake_case)]
#![allow(dead_code)]
use std::collections::HashMap;
use std::sync::RwLock;
use std::sync::atomic::{AtomicU8, Ordering};

#[repr(transparent)]
pub struct UserFlags(pub u8);

impl UserFlags {
    pub const IN_CALL: u8 = 1 << 0;
    pub const MUTED: u8 = 1 << 1;
    pub const DEAFENED: u8 = 1 << 2;
    pub const STREAMING: u8 = 1 << 3;
    pub const MOBILE: u8 = 1 << 4;
    pub const BOT: u8 = 1 << 5;

    #[inline(always)]
    pub fn is_in_call(&self) -> bool {
        self.0 & Self::IN_CALL != 0
    }
    #[inline(always)]
    pub fn set_in_call(&mut self) {
        self.0 |= Self::IN_CALL;
    }
    #[inline(always)]
    pub fn clear_in_call(&mut self) {
        self.0 &= !Self::IN_CALL;
    }
}

pub mod UserStatus {
    pub const ONLINE: u8 = 0x00;
    pub const AWAY: u8 = 0x01;
    pub const BUSY: u8 = 0x02;
    pub const OFFLINE: u8 = 0x03;
}

#[repr(C, align(64))]
pub struct User {
    pub id: u64,
    name: [u8; 32],
    name_len: u8,
    pub status: AtomicU8,
    pub flags: UserFlags,
    _padding: [u8; 21],
}

impl User {
    pub fn new(id: u64, username: &str) -> Self {
        let mut name = [0u8; 32];
        let len = username.len().min(32);
        name[..len].copy_from_slice(&username.as_bytes()[..len]);
        Self {
            id,
            name,
            name_len: len as u8,
            status: AtomicU8::new(UserStatus::ONLINE),
            flags: UserFlags(0),
            _padding: [0u8; 21],
        }
    }

    pub fn name(&self) -> &str {
        std::str::from_utf8(&self.name[..self.name_len as usize]).unwrap_or("")
    }
}

pub struct UserPool {
    users: RwLock<HashMap<u64, User>>,
}

impl UserPool {
    pub fn new() -> Self {
        Self {
            users: RwLock::new(HashMap::new()),
        }
    }

    pub fn insert(&self, user: User) {
        self.users.write().unwrap().insert(user.id, user);
    }

    pub fn remove(&self, user_id: u64) {
        self.users.write().unwrap().remove(&user_id);
    }

    pub fn get_name(&self, user_id: u64) -> Option<String> {
        self.users
            .read()
            .unwrap()
            .get(&user_id)
            .map(|u| u.name().to_owned())
    }

    pub fn set_status(&self, user_id: u64, status: u8) {
        let users = self.users.read().unwrap();
        if let Some(user) = users.get(&user_id) {
            user.status.store(status, Ordering::Relaxed);
        }
    }

    pub fn set_flag(&self, user_id: u64, flag: u8) {
        let mut users = self.users.write().unwrap();
        if let Some(user) = users.get_mut(&user_id) {
            user.flags.0 |= flag;
        }
    }

    pub fn clear_flag(&self, user_id: u64, flag: u8) {
        let mut users = self.users.write().unwrap();
        if let Some(user) = users.get_mut(&user_id) {
            user.flags.0 &= !flag;
        }
    }
}
