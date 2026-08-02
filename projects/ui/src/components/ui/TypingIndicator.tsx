export function TypingIndicator() {
  const delays = ["0s", "0.25s", "0.5s"];
  return (
    <div className="flex items-center gap-1">
      {delays.map((d, i) => (
        <span key={i} data-dot className="rounded-full bg-[#3a3d44] animate-[pulse_1.2s_infinite]"
          style={{ width: 5, height: 5, animationDelay: d }} />
      ))}
    </div>
  );
}
