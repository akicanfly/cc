import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { useInterval } from 'usehooks-ts';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { Box, Text } from '../ink.js';
import { type AutoUpdaterResult, getLatestVersion, getMaxVersion, type InstallStatus, installGlobalPackage, shouldSkipVersion } from '../utils/autoUpdater.js';
import { getGlobalConfig, isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { installOrUpdateClaudePackage, localInstallationExists } from '../utils/localInstaller.js';
import { removeInstalledSymlink } from '../utils/nativeInstaller/index.js';
import { gt, gte } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';
type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};
export function AutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    global?: string | null;
    latest?: string | null;
  }>({});
  const [hasLocalInstall, setHasLocalInstall] = useState(false);
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version);
  useEffect(() => {
    void localInstallationExists().then(setHasLocalInstall);
  }, []);

  // Track latest isUpdating value in a ref so the memoized checkForUpdates
  // callback always sees the current value. Without this, the 30-minute
  // interval fires with a stale closure where isUpdating is false, allowing
  // a concurrent installGlobalPackage() to run while one is already in
  // progress.
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
  const checkForUpdates = React.useCallback(async () => {
    // STRIPPED: auto-updater network checks removed in this build.
    return;
  }, []);

  // Initial check
  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  // Check every 30 minutes
  useInterval(checkForUpdates, 30 * 60 * 1000);
  if (!autoUpdaterResult?.version && (!versions.global || !versions.latest)) {
    return null;
  }
  if (!autoUpdaterResult?.version && !isUpdating) {
    return null;
  }
  return <Box flexDirection="row" gap={1}>
      {verbose && <Text dimColor wrap="truncate">
          globalVersion: {versions.global} &middot; latestVersion:{' '}
          {versions.latest}
        </Text>}
      {isUpdating ? <>
          <Box>
            <Text color="text" dimColor wrap="truncate">
              Auto-updating…
            </Text>
          </Box>
        </> : autoUpdaterResult?.status === 'success' && showSuccessMessage && updateSemver && <Text color="success" wrap="truncate">
            ✓ Update installed · Restart to apply
          </Text>}
      {(autoUpdaterResult?.status === 'install_failed' || autoUpdaterResult?.status === 'no_permissions') && <Text color="error" wrap="truncate">
          ✗ Auto-update failed &middot; Try <Text bold>claude doctor</Text> or{' '}
          <Text bold>
            {hasLocalInstall ? `cd ~/.claude/local && npm update ${MACRO.PACKAGE_URL}` : `npm i -g ${MACRO.PACKAGE_URL}`}
          </Text>
        </Text>}
    </Box>;
}
