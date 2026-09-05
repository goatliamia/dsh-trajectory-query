// dsh-analysis-view host half — no-op stub.
//
// This plugin is a pure client half (browser-only): the host entry exists to
// keep the package loadable by the dsh CLI's cordis loader. All behavior
// lives in the `dsh.client` web entry (exports["./client"] → lib/client.js),
// which the harness web app loads via the ModuleLoader handoff.
function apply() {}

export { apply };
