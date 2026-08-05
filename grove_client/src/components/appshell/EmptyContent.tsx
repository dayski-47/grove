import { DecryptReveal } from "../motion/DecryptReveal";

const EMPTY_FIREFLIES = [
    { left: "22%", top: "35%", delay: "0s",   cls: "" },
    { left: "58%", top: "28%", delay: "2.1s", cls: "gv-firefly-b" },
    { left: "38%", top: "52%", delay: "1.3s", cls: "gv-firefly-c" },
    { left: "70%", top: "45%", delay: "3.5s", cls: "" },
    { left: "15%", top: "62%", delay: "0.7s", cls: "gv-firefly-b" },
];

export function EmptyContent() {
    return (
        <div className="gv-empty">
            {EMPTY_FIREFLIES.map((f, i) => (
                <div key={i} className={`gv-firefly ${f.cls}`} style={{ left: f.left, top: f.top, animationDelay: f.delay }} aria-hidden="true" />
            ))}
            <div className="gv-empty-brand" aria-label="Grove">
                <DecryptReveal text="grove" />
            </div>
            <p className="gv-empty-tagline" aria-label="an enchanted place to gather">
                <DecryptReveal text="an enchanted place to gather" durationMs={700} />
            </p>
            <div className="gv-empty-floor" aria-hidden="true">
                <svg viewBox="0 0 600 160" className="gv-floor-svg">
                    {/* Ground */}
                    <path d="M 0 132 C 80 122 160 134 240 124 C 320 114 400 130 480 120 C 530 113 565 122 600 116 L 600 200 L 0 200 Z" fill="#010301"/>
                    <path d="M 0 140 C 100 133 210 142 320 135 C 420 128 520 138 600 132 L 600 200 L 0 200 Z" fill="#010201"/>
                    {/* Roots */}
                    <path d="M 42 132 C 90 122 148 128 198 122" stroke="#070d07" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
                    <path d="M 62 139 C 100 133 132 136 158 132" stroke="#050a05" strokeWidth="2" fill="none" strokeLinecap="round"/>
                    <path d="M 392 128 C 440 120 490 126 545 122" stroke="#070d07" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    {/* Left fern */}
                    <path d="M 145 132 C 133 112 128 98 136 86" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 145 132 C 157 114 162 100 154 90" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 145 132 C 138 118 136 108 142 102" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    <path d="M 145 132 C 152 120 156 110 150 103" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    {/* Left mushroom cluster */}
                    <rect x="84" y="106" width="7" height="20" rx="2" fill="#0c140c"/>
                    <ellipse cx="87.5" cy="105" rx="13" ry="6" fill="#170d08"/>
                    <rect x="100" y="112" width="5" height="14" rx="1.5" fill="#0f170f"/>
                    <ellipse cx="102.5" cy="111" rx="9" ry="4.5" fill="#1a1008"/>
                    <rect x="70" y="114" width="5" height="12" rx="1.5" fill="#0c140c"/>
                    <ellipse cx="72.5" cy="113" rx="8" ry="4" fill="#120e06"/>
                    {/* Center tall mushroom */}
                    <rect x="270" y="88" width="12" height="38" rx="3.5" fill="#0e180e"/>
                    <ellipse cx="276" cy="87" rx="22" ry="10" fill="#1c1008"/>
                    <ellipse cx="273" cy="83" rx="15" ry="6" fill="#221408" opacity="0.7"/>
                    <ellipse cx="271" cy="82" rx="7" ry="3" fill="rgba(180,140,55,0.07)"/>
                    {/* Center mushroom 2 */}
                    <rect x="295" y="98" width="9" height="28" rx="2.5" fill="#0c180c"/>
                    <ellipse cx="299.5" cy="97" rx="16" ry="8" fill="#160e06"/>
                    {/* Center mushroom 3 small */}
                    <rect x="317" y="108" width="6" height="18" rx="2" fill="#101810"/>
                    <ellipse cx="320" cy="107" rx="11" ry="5.5" fill="#1a1208"/>
                    {/* Right fern */}
                    <path d="M 460 130 C 448 110 445 96 454 84" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 460 130 C 472 112 476 98 468 88" stroke="#091609" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <path d="M 460 130 C 452 116 450 106 456 100" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    <path d="M 460 130 C 468 118 468 108 463 102" stroke="#091609" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    {/* Right mushroom cluster */}
                    <rect x="515" y="104" width="8" height="22" rx="2.5" fill="#0c140c"/>
                    <ellipse cx="519" cy="103" rx="14" ry="7" fill="#1a1008"/>
                    <rect x="528" y="110" width="6" height="16" rx="2" fill="#0f170f"/>
                    <ellipse cx="531" cy="109" rx="10" ry="5" fill="#160e08"/>
                    <rect x="502" y="112" width="5" height="12" rx="1.5" fill="#0c140c"/>
                    <ellipse cx="504.5" cy="111" rx="8" ry="4" fill="#1a1208"/>
                    {/* Scattered debris */}
                    <ellipse cx="180" cy="135" rx="10" ry="3.5" fill="#080e08" opacity="0.55"/>
                    <ellipse cx="356" cy="130" rx="12" ry="4" fill="#080e08" opacity="0.45"/>
                    <ellipse cx="430" cy="133" rx="8" ry="3" fill="#080e08" opacity="0.5"/>
                </svg>
            </div>
            <div className="gv-empty-hint">
                <kbd className="gv-kbd">ctrl</kbd>
                <span className="gv-kbd-sep">+</span>
                <kbd className="gv-kbd">k</kbd>
                <span className="gv-kbd-text">to open a channel</span>
            </div>
        </div>
    );
}
