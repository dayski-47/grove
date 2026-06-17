// src/components/CallUI.tsx
import type { CallState } from "../useWebRTC";

export function CallUI({
    callState,
    remoteUserId,
    usernames,
    onAccept,
    onDecline,
    onHangup,
}: {
    callState:    CallState;
    remoteUserId: number | null;
    usernames:    Record<number, string>;
    onAccept:  () => void;
    onDecline: () => void;
    onHangup:  () => void;
}) {
    if (callState === "idle") return null;

    const name =
        remoteUserId !== null ? (usernames[remoteUserId] ?? `user ${remoteUserId}`) : "unknown";

    if (callState === "ringing") {
        return (
            <div className="grove-call-notification">
                <span className="grove-call-who">incoming call from {name}</span>
                <div className="grove-call-actions">
                    <button className="grove-call-accept" onClick={onAccept}>
                        accept
                    </button>
                    <button className="grove-call-decline" onClick={onDecline}>
                        decline
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`grove-call-bar${callState === "active" ? " grove-call-active" : ""}`}>
            <span className="grove-call-who">
                {callState === "calling" ? `calling ${name}…` : `in call with ${name}`}
            </span>
            <button className="grove-call-hangup" onClick={onHangup}>
                hang up
            </button>
        </div>
    );
}
