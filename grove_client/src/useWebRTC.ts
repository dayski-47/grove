// src/useWebRTC.ts
import { useCallback, useRef, useState } from "react";
import type { SignalingMessage } from "./types";

export type CallState = "idle" | "calling" | "ringing" | "active";

export function useWebRTC(
    myUserId: number,
    sendSignaling: (msg: SignalingMessage) => void,
) {
    const [callState, setCallState]       = useState<CallState>("idle");
    const [remoteUserId, setRemoteUserId] = useState<number | null>(null);
    const pcRef        = useRef<RTCPeerConnection | null>(null);
    const pendingOffer = useRef<{ from: number; sdp: string } | null>(null);
    const remoteIdRef  = useRef<number | null>(null);

    const cleanup = useCallback(() => {
        pcRef.current?.close();
        pcRef.current        = null;
        remoteIdRef.current  = null;
        pendingOffer.current = null;
        setCallState("idle");
        setRemoteUserId(null);
    }, []);

    const buildPeerConnection = useCallback(
        (toUserId: number): RTCPeerConnection => {
            remoteIdRef.current = toUserId;
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
            });

            pc.onicecandidate = (e) => {
                if (!e.candidate || remoteIdRef.current === null) return;
                sendSignaling({
                    type: "IceCandidate",
                    from: myUserId,
                    to: remoteIdRef.current,
                    candidate: JSON.stringify(e.candidate),
                });
            };

            pc.ontrack = (e) => {
                const el = document.getElementById("grove-remote-audio") as HTMLAudioElement | null;
                if (el) el.srcObject = e.streams[0];
            };

            pc.onconnectionstatechange = () => {
                if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
                    cleanup();
                }
            };

            return pc;
        },
        [myUserId, sendSignaling, cleanup],
    );

    const initiateCall = useCallback(
        async (toUserId: number) => {
            setCallState("calling");
            setRemoteUserId(toUserId);

            const pc = buildPeerConnection(toUserId);
            pcRef.current = pc;

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            sendSignaling({ type: "CallOffer", from: myUserId, to: toUserId, sdp: offer.sdp! });
        },
        [myUserId, sendSignaling, buildPeerConnection],
    );

    const acceptCall = useCallback(async () => {
        const pending = pendingOffer.current;
        if (!pending) return;
        pendingOffer.current = null;

        const pc = buildPeerConnection(pending.from);
        pcRef.current = pc;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        await pc.setRemoteDescription({ type: "offer", sdp: pending.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignaling({ type: "CallAnswer", from: myUserId, to: pending.from, sdp: answer.sdp! });
        setCallState("active");
    }, [myUserId, sendSignaling, buildPeerConnection]);

    const declineCall = useCallback(() => {
        const pending = pendingOffer.current;
        if (pending) {
            sendSignaling({ type: "CallHangup", from: myUserId, to: pending.from });
        }
        cleanup();
    }, [myUserId, sendSignaling, cleanup]);

    const hangup = useCallback(() => {
        if (remoteIdRef.current !== null) {
            sendSignaling({ type: "CallHangup", from: myUserId, to: remoteIdRef.current });
        }
        cleanup();
    }, [myUserId, sendSignaling, cleanup]);

    const handleSignal = useCallback(async (msg: SignalingMessage) => {
        switch (msg.type) {
            case "CallOffer":
                pendingOffer.current = { from: msg.from, sdp: msg.sdp };
                setRemoteUserId(msg.from);
                setCallState("ringing");
                break;

            case "CallAnswer":
                if (pcRef.current) {
                    await pcRef.current.setRemoteDescription({ type: "answer", sdp: msg.sdp });
                    setCallState("active");
                }
                break;

            case "IceCandidate":
                if (pcRef.current) {
                    await pcRef.current.addIceCandidate(
                        JSON.parse(msg.candidate) as RTCIceCandidateInit,
                    );
                }
                break;

            case "CallHangup":
                pcRef.current?.close();
                pcRef.current        = null;
                remoteIdRef.current  = null;
                pendingOffer.current = null;
                setCallState("idle");
                setRemoteUserId(null);
                break;
        }
    }, []);

    return { callState, remoteUserId, initiateCall, acceptCall, declineCall, hangup, handleSignal };
}
