import { useCapabilities } from './useCapabilities';

/** Top-left chrome: the Jarwiz wordmark chip and the live/demo badge. */
export function Topbar() {
  const caps = useCapabilities();

  return (
    <div className="jz-topbar">
      <div className="jz-wordmark">
        <span className="jz-spark" aria-hidden>
          ✦
        </span>
        Jarwiz
      </div>
      {caps?.live === false ? (
        <span
          className="jz-demo-badge"
          title="No API key configured — agents run a scripted demo, so output is illustrative rather than real."
        >
          Demo mode
        </span>
      ) : null}
    </div>
  );
}
