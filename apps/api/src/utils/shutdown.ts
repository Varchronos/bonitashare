// Must stay under the service's stop_grace_period in docker compose, or Docker SIGKILLs first.
const HARD_DEADLINE_MS = 28_000;

// Runs `shutdown` once on SIGTERM (docker stop) or SIGINT (Ctrl-C), then exits. If it hangs past
// the deadline, exits anyway so a stuck close can't turn into a SIGKILL. A second Ctrl-C kills
// immediately, since the handlers are one-shot.
export function onShutdown(name: string, shutdown: () => Promise<void>) {
    let started = false;

    const run = async (signal: NodeJS.Signals) => {
        if (started) return;
        started = true;
        console.log(`${name}: ${signal} received, shutting down`);

        // we use unref here because we do not want the event loop to wait for this timeout
        // if there is no process running ignore the timeout below and end the nodejs runtime
        setTimeout(() => {
            console.error(`${name}: shutdown exceeded ${HARD_DEADLINE_MS}ms, exiting`);
            process.exit(1);
        }, HARD_DEADLINE_MS).unref();

        try {
            await shutdown();
            console.log(`${name}: shutdown complete`);
            process.exit(0);
        } catch (err) {
            console.error(`${name}: shutdown failed`, err);
            process.exit(1);
        }
    };

    process.once('SIGTERM', run);
    process.once('SIGINT', run);
}
