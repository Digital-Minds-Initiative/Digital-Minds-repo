import authAr from '@/client/features/auth/messages/ar.json';
import clubsAr from '@/client/features/clubs/messages/ar.json';
import membersAr from '@/client/features/members/messages/ar.json';
import permissionsAr from '@/client/features/permissions/messages/ar.json';
import pointsAr from '@/client/features/points/messages/ar.json';

import commonAr from './messages/ar/common.json';
import dashboardAr from './messages/ar/dashboard.json';
import landingAr from './messages/ar/landing.json';
import membersExportAr from './messages/ar/membersExport.json';
import shellAr from './messages/ar/shell.json';
import uiAr from './messages/ar/ui.json';

/**
 * All UI strings, per locale and namespace. Shared namespaces live in ./messages/<locale>/;
 * each client feature keeps its own in src/client/features/<feature>/messages/<locale>.json.
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
    membersExport: membersExportAr,
    clubs: clubsAr,
    points: pointsAr,
    permissions: permissionsAr,
  },
};
