/**
 * Dynamic Expo Configuration (`apps/customer-mobile/app.config.js`)
 *
 * One-time EAS Project Initialization:
 *   1. Run `cd apps/customer-mobile && npx eas-cli init` to register the project with Expo Application Services (EAS).
 *   2. Copy the generated EAS Project UUID into `EXPO_PUBLIC_EAS_PROJECT_ID` in `apps/customer-mobile/.env`
 *      and configure it in CI/EAS secrets (`EXPO_PUBLIC_EAS_PROJECT_ID` / `EAS_PROJECT_ID`).
 *
 * Build & Startup Enforcement:
 *   Fails fast with a clear error if `EXPO_PUBLIC_EAS_PROJECT_ID` (or `EAS_PROJECT_ID`) is missing or malformed.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_REGEX = /(replace[_-]?me|placeholder|change[_-]?me|^todo$|^<.*>$)/i;

const REQUIRED_GRIEVANCE_VARS = [
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME',
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_EMAIL',
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_PHONE',
  'EXPO_PUBLIC_GRIEVANCE_OFFICER_ADDRESS',
];

module.exports = ({ config }) => {
  const envProjectId = (process.env.EXPO_PUBLIC_EAS_PROJECT_ID || process.env.EAS_PROJECT_ID || '').trim();
  if (process.env.EAS_BUILD === 'true' && !envProjectId) {
    throw new Error(
      'Missing or invalid EXPO_PUBLIC_EAS_PROJECT_ID (or EAS_PROJECT_ID). ' +
        'Run `cd apps/customer-mobile && npx eas-cli init` once to create your EAS project, ' +
        'then set EXPO_PUBLIC_EAS_PROJECT_ID=<your-eas-project-uuid> in your environment.'
    );
  }

  const rawProjectId = (
    envProjectId ||
    config?.extra?.eas?.projectId ||
    ''
  ).trim();

  if (!rawProjectId || !UUID_REGEX.test(rawProjectId) || PLACEHOLDER_REGEX.test(rawProjectId)) {
    throw new Error(
      'Missing or invalid EXPO_PUBLIC_EAS_PROJECT_ID (or EAS_PROJECT_ID). ' +
        'Run `cd apps/customer-mobile && npx eas-cli init` once to create your EAS project, ' +
        'then set EXPO_PUBLIC_EAS_PROJECT_ID=<your-eas-project-uuid> in your environment.'
    );
  }

  for (const key of REQUIRED_GRIEVANCE_VARS) {
    const val = (process.env[key] || '').trim();
    if (!val || PLACEHOLDER_REGEX.test(val)) {
      throw new Error(
        `Missing or placeholder value for required environment variable "${key}". ` +
          'Supply authentic Grievance Officer details via EXPO_PUBLIC_GRIEVANCE_OFFICER_* environment variables before building.'
      );
    }
  }

  return {
    ...config,
    extra: {
      ...(config.extra || {}),
      eas: {
        ...(config.extra?.eas || {}),
        projectId: rawProjectId,
      },
      grievanceOfficer: {
        name: process.env.EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME.trim(),
        email: process.env.EXPO_PUBLIC_GRIEVANCE_OFFICER_EMAIL.trim(),
        phone: process.env.EXPO_PUBLIC_GRIEVANCE_OFFICER_PHONE.trim(),
        address: process.env.EXPO_PUBLIC_GRIEVANCE_OFFICER_ADDRESS.trim(),
      },
    },
  };
};

