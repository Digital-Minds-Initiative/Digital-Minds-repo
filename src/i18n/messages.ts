import authAr from '@/modules/auth/messages/ar.json';
import membersAr from '@/modules/members/messages/ar.json';

import commonAr from './messages/ar/common.json';
import dashboardAr from './messages/ar/dashboard.json';
import landingAr from './messages/ar/landing.json';
import shellAr from './messages/ar/shell.json';
import uiAr from './messages/ar/ui.json';

/**
 * All UI strings, per locale and namespace. Shared namespaces live in ./messages/<locale>/;
 * each feature module keeps its own in src/modules/<module>/messages/<locale>.json.
 * Adding a namespace: import it here — next-intl then type-checks every key.
 */
export const messages = {
  ar: {
    common: commonAr,
    ui: uiAr,
    shell: shellAr,
    landing: landingAr,
    dashboard: dashboardAr,
    auth: authAr,
    members: membersAr,
  },
};
