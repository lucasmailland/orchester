// cytoscape-fcose ships no type declarations. It's a cytoscape layout
// extension registered via `cytoscape.use(fcose)`; we only need the module to
// resolve. Layout options are passed loosely (cast at the call site).
declare module "cytoscape-fcose";
