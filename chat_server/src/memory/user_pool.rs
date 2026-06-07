// src/memory/user_pool.rs

use std::sync::atomic::AtomicU8;

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
    id: u64,
    name: [u8; 32],
    name_len: u8,
    status: AtomicU8,
    flags: UserFlags,
    _padding: [u8; 21],
}
