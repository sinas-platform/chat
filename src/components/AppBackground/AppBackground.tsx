import "./AppBackground.scss";

type AppBackgroundProps = {
  className?: string;
};

export function AppBackground({ className }: AppBackgroundProps) {
  const rootClassName = className ? `app-background ${className}` : "app-background";

  return <div className={rootClassName} aria-hidden="true" />;
}
