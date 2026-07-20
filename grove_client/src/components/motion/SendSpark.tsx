import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface SendSparkHandle {
    burst: () => void;
}

interface Spark {
    x:         number;
    y:         number;
    angle:     number;
    startTime: number;
}

const DURATION     = 350;
const SPARK_COUNT  = 7;
const SPARK_SIZE   = 8;
const SPARK_RADIUS = 14;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ease(t: number): number {
    return t * (2 - t);
}

function resolveColor(value: string, el: Element): string {
    const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (!match) return value;
    const resolved = getComputedStyle(el).getPropertyValue(match[1]).trim();
    return resolved || value;
}

/**
 * Ported from reactbits' ClickSpark, which is already zero-dependency
 * (canvas + requestAnimationFrame, no framer-motion). Simplified from a
 * full-size click-anywhere wrapper into a small imperative-ref component
 * so it can be scoped to exactly one button and triggered from app logic
 * (message send) instead of every click in its subtree.
 */
export const SendSpark = forwardRef<SendSparkHandle, { color?: string }>(
    function SendSpark({ color = "#6ab870" }, ref) {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const sparksRef = useRef<Spark[]>([]);
        const rafRef    = useRef<number | undefined>(undefined);

        useEffect(() => {
            const canvas = canvasRef.current;
            const parent = canvas?.parentElement;
            if (!canvas || !parent) return;

            const resize = () => {
                const { width, height } = parent.getBoundingClientRect();
                canvas.width  = width;
                canvas.height = height;
            };
            resize();

            const ro = new ResizeObserver(resize);
            ro.observe(parent);
            return () => ro.disconnect();
        }, []);

        useEffect(() => {
            const canvas = canvasRef.current;
            const ctx    = canvas?.getContext("2d");
            if (!canvas || !ctx) return;

            const resolvedColor = resolveColor(color, canvas);

            const draw = (now: number) => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                sparksRef.current = sparksRef.current.filter(spark => {
                    const elapsed = now - spark.startTime;
                    if (elapsed >= DURATION) return false;

                    const progress = ease(elapsed / DURATION);
                    const distance = progress * SPARK_RADIUS;
                    const length   = SPARK_SIZE * (1 - progress);
                    const x1 = spark.x + distance * Math.cos(spark.angle);
                    const y1 = spark.y + distance * Math.sin(spark.angle);
                    const x2 = spark.x + (distance + length) * Math.cos(spark.angle);
                    const y2 = spark.y + (distance + length) * Math.sin(spark.angle);

                    ctx.strokeStyle = resolvedColor;
                    ctx.lineWidth   = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                    return true;
                });
                rafRef.current = requestAnimationFrame(draw);
            };

            rafRef.current = requestAnimationFrame(draw);
            return () => {
                if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
            };
        }, [color]);

        useImperativeHandle(ref, () => ({
            burst() {
                if (prefersReducedMotion()) return;
                const canvas = canvasRef.current;
                if (!canvas) return;

                const cx  = canvas.width / 2;
                const cy  = canvas.height / 2;
                const now = performance.now();
                const newSparks: Spark[] = Array.from({ length: SPARK_COUNT }, (_, i) => ({
                    x: cx, y: cy,
                    angle: (2 * Math.PI * i) / SPARK_COUNT,
                    startTime: now,
                }));
                sparksRef.current.push(...newSparks);
            },
        }));

        return <canvas ref={canvasRef} className="dw-send-spark-canvas" aria-hidden="true" />;
    },
);
