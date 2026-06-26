import { createTableExtended } from './src/tableExtended';

const tableExtended = createTableExtended();

const activate = (): void => {
  tableExtended.mount();
};

const deactivate = (): void => {
  tableExtended.unmount();
};

window.pluginActivators = window.pluginActivators ?? {};
window.pluginActivators['growi-plugin-table-extended'] = { activate, deactivate };
