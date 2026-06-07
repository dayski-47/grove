// src/protocol/message.rs

use std::io;

#[allow(non_snake_case)]
pub mod MessageType {
    pub const TEXT: u8 = 0x01;
    pub const IMAGE: u8 = 0x02;
    pub const TYPING: u8 = 0x03;
    pub const PRESENCE: u8 = 0x04;
    pub const CALL_SIGNAL: u8 = 0x05;
}

#[repr(C)]
pub struct MessageHeader {
    pub msg_type: u8,
    pub user_id: u32,
    pub channel_id: u32,
    pub timestamp: u32,
    pub text_len: u16,
}

impl MessageHeader {
    pub const SIZE: usize = 15; // 15 bytes in MessageHeader

    pub fn from_bytes(buf: &[u8]) -> std::io::Result<Self> {
        // static constructor
        if buf.len() < Self::SIZE {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Buffer too small",
            ));
        }

        Ok(Self {
            msg_type: buf[0],
            user_id: u32::from_le_bytes([buf[1], buf[2], buf[3], buf[4]]),
            channel_id: u32::from_le_bytes([buf[5], buf[6], buf[7], buf[8]]),
            timestamp: u32::from_le_bytes([buf[9], buf[10], buf[11], buf[12]]),
            text_len: u16::from_le_bytes([buf[13], buf[14]]),
        })
    }

    pub fn to_bytes(&self, buf: &mut [u8]) -> std::io::Result<()> {
        if buf.len() < Self::SIZE {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Buffer too small",
            ));
        }

        buf[0] = self.msg_type;
        buf[1..5].copy_from_slice(&self.user_id.to_le_bytes());
        buf[5..9].copy_from_slice(&self.channel_id.to_le_bytes());
        buf[9..13].copy_from_slice(&self.timestamp.to_le_bytes());
        buf[9..11].copy_from_slice(&self.text_len.to_le_bytes());
        Ok(())
    }
}

pub struct Message<'a> {
    pub header: MessageHeader,
    pub payload: &'a [u8],
}

impl<'a> Message<'a> {
    pub fn parse(buf: &'a [u8]) -> std::io::Result<Self> {
        let header = MessageHeader::from_bytes(buf)?;
        let payload_start = MessageHeader::SIZE;
        let payload_end = payload_start + header.text_len as usize;

        if buf.len() < payload_end {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Incomplete message",
            ));
        }

        Ok(Self {
            header,
            payload: &buf[payload_start..payload_end],
        })
    }

    pub fn text(&self) -> std::io::Result<&'a str> {
        std::str::from_utf8(self.payload)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }
}
