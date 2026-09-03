interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export default function Skeleton({
  width = "100%",
  height = "16px",
  className = "",
}: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height, display: "block" }}
      aria-hidden="true"
    />
  );
}
