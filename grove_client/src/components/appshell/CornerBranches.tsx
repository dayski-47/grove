export function CornerBranches() {
    const paths = (
        <>
            <path d="M 0 0 C 35 28 62 58 92 100" stroke="#0c1e0c" strokeWidth="5.5" fill="none" strokeLinecap="round"/>
            <path d="M 28 24 C 58 10 90 6 108 10" stroke="#0c1e0c" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <path d="M 58 62 C 85 48 105 40 118 44" stroke="#0c1e0c" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <path d="M 42 42 C 58 30 66 21 74 17" stroke="#0c1e0c" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            <path d="M 74 84 C 92 74 102 68 112 72" stroke="#0c1e0c" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </>
    );
    return (
        <div className="gv-corners" aria-hidden="true">
            <svg className="gv-corner gv-corner-tl" viewBox="0 0 220 180">{paths}</svg>
            <svg className="gv-corner gv-corner-tr" viewBox="0 0 220 180" style={{ transform: "scaleX(-1)" }}>{paths}</svg>
            <svg className="gv-corner gv-corner-bl" viewBox="0 0 220 180" style={{ transform: "scaleY(-1)" }}>{paths}</svg>
            <svg className="gv-corner gv-corner-br" viewBox="0 0 220 180" style={{ transform: "scale(-1)" }}>{paths}</svg>
        </div>
    );
}
