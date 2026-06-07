// src/signaling/types.rs
#![allow(dead_code)]
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalingMessage {
    CallOffer {
        from: u64,
        to: u64,
        sdp: String,
    },
    CallAnswer {
        from: u64,
        to: u64,
        sdp: String,
    },
    IceCandidate {
        from: u64,
        to: u64,
        candidate: String,
    },
    CallHangup {
        from: u64,
        to: u64,
    },
}
