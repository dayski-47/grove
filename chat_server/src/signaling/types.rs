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

impl SignalingMessage {
    // overwrite from with the authenticated user_id; prevents caller spoofing
    pub fn with_from(self, from: u64) -> Self {
        match self {
            Self::CallOffer { to, sdp, .. } => Self::CallOffer { from, to, sdp },
            Self::CallAnswer { to, sdp, .. } => Self::CallAnswer { from, to, sdp },
            Self::IceCandidate { to, candidate, .. } => Self::IceCandidate {
                from,
                to,
                candidate,
            },
            Self::CallHangup { to, .. } => Self::CallHangup { from, to },
        }
    }
}
