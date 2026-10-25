import Modal from '@app/components/Common/Modal';
import {
  ArrConnectionFields,
  ArrSelectField,
  ArrServiceOptions,
  ArrTagsField,
  arrProfileOptions,
} from '@app/components/Settings/ArrFormFields';
import type { RadarrTestResponse } from '@app/components/Settings/SettingsServices';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { Transition } from '@headlessui/react';
import type { RadarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.RadarrModal', {
  createradarr: 'Add New Radarr Server',
  create4kradarr: 'Add New 4K Radarr Server',
  editradarr: 'Edit Radarr Server',
  edit4kradarr: 'Edit 4K Radarr Server',
  validationNameRequired: 'You must provide a server name',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  validationRootFolderRequired: 'You must select a root folder',
  validationProfileRequired: 'You must select a quality profile',
  validationMinimumAvailabilityRequired:
    'You must select a minimum availability',
  toastRadarrTestSuccess: 'Radarr connection established successfully!',
  toastRadarrTestFailure: 'Failed to connect to Radarr.',
  add: 'Add Server',
  defaultserver: 'Default Server',
  default4kserver: 'Default 4K Server',
  servername: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  baseUrl: 'URL Base',
  syncEnabled: 'Enable Scan',
  externalUrl: 'External URL',
  qualityprofile: 'Quality Profile',
  rootfolder: 'Root Folder',
  minimumAvailability: 'Minimum Availability',
  server4k: '4K Server',
  server4kHelp:
    'Only if you have a separate 4K instance. Leave unchecked for a single server.',
  selectQualityProfile: 'Select quality profile',
  selectRootFolder: 'Select root folder',
  selectMinimumAvailability: 'Select minimum availability',
  loadingprofiles: 'Loading quality profiles…',
  testFirstQualityProfiles: 'Test connection to load quality profiles',
  loadingrootfolders: 'Loading root folders…',
  testFirstRootFolders: 'Test connection to load root folders',
  loadingTags: 'Loading tags…',
  testFirstTags: 'Test connection to load tags',
  tags: 'Tags',
  enableSearch: 'Enable Automatic Search',
  tagRequests: 'Tag Requests',
  tagRequestsInfo:
    "Automatically add an additional tag with the requester's user ID & display name",
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationBaseUrlLeadingSlash: 'URL base must have a leading slash',
  validationBaseUrlTrailingSlash: 'URL base must not end in a trailing slash',
  notagoptions: 'No tags.',
  selecttags: 'Select tags',
  announced: 'Announced',
  inCinemas: 'In Cinemas',
  released: 'Released',
  apiKeyHelp: 'Find it in Radarr: Settings > General > Security > API Key',
  baseUrlHelp:
    'If you set a URL Base in Radarr (Settings > General > Host), enter it here (e.g. /radarr). Leave blank otherwise.',
  externalUrlHelp:
    'For clickable links on media pages when the hostname is not reachable from outside your network.',
  syncEnabledHelp:
    'Scan Radarr for existing media and request status so users cannot request content already available.',
  enableSearchHelp:
    'Automatically trigger a search in Radarr when a request is approved.',
});

interface RadarrModalProps {
  radarr: RadarrSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const RadarrModal = ({ onClose, radarr, onSave }: RadarrModalProps) => {
  const intl = useIntl();
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(radarr ? true : false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResponse, setTestResponse] = useState<RadarrTestResponse>({
    profiles: [],
    rootFolders: [],
    tags: [],
  });

  const profileOptions = arrProfileOptions(testResponse.profiles, intl.locale);
  const rootFolderOptions = testResponse.rootFolders.map((folder) => ({
    value: folder.path,
    label: folder.path,
  }));

  const RadarrSettingsSchema = Yup.object().shape({
    name: Yup.string().required(
      intl.formatMessage(messages.validationNameRequired)
    ),
    hostname: Yup.string().required(
      intl.formatMessage(messages.validationHostnameRequired)
    ),
    port: Yup.number()
      .nullable()
      .required(intl.formatMessage(messages.validationPortRequired)),
    apiKey: Yup.string().required(
      intl.formatMessage(messages.validationApiKeyRequired)
    ),
    rootFolder: Yup.string().required(
      intl.formatMessage(messages.validationRootFolderRequired)
    ),
    activeProfileId: Yup.string().required(
      intl.formatMessage(messages.validationProfileRequired)
    ),
    minimumAvailability: Yup.string().required(
      intl.formatMessage(messages.validationMinimumAvailabilityRequired)
    ),
    externalUrl: Yup.string()
      .test(
        'valid-url',
        intl.formatMessage(messages.validationApplicationUrl),
        isValidURL
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationApplicationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
    baseUrl: Yup.string()
      .test(
        'leading-slash',
        intl.formatMessage(messages.validationBaseUrlLeadingSlash),
        (value) => !value || value.startsWith('/')
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationBaseUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
  });

  const testConnection = useCallback(
    async ({
      hostname,
      port,
      apiKey,
      baseUrl,
      useSsl = false,
    }: {
      hostname: string;
      port: number;
      apiKey: string;
      baseUrl?: string;
      useSsl?: boolean;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<RadarrTestResponse>(
          '/api/v1/settings/radarr/test',
          {
            hostname,
            apiKey,
            port: Number(port),
            baseUrl,
            useSsl,
          }
        );

        setIsValidated(true);
        setTestResponse(response.data);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastRadarrTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
      } catch {
        setIsValidated(false);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastRadarrTestFailure), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      } finally {
        setIsTesting(false);
        initialLoad.current = true;
      }
    },
    [addToast, intl]
  );

  useEffect(() => {
    if (radarr) {
      testConnection({
        apiKey: radarr.apiKey,
        hostname: radarr.hostname,
        port: radarr.port,
        baseUrl: radarr.baseUrl,
        useSsl: radarr.useSsl,
      });
    }
  }, [radarr, testConnection]);

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity ease-in-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Formik
        initialValues={{
          name: radarr?.name,
          hostname: radarr?.hostname,
          port: radarr?.port ?? 7878,
          ssl: radarr?.useSsl ?? false,
          apiKey: radarr?.apiKey,
          baseUrl: radarr?.baseUrl,
          activeProfileId: radarr?.activeProfileId,
          rootFolder: radarr?.activeDirectory,
          minimumAvailability: radarr?.minimumAvailability ?? 'released',
          tags: radarr?.tags ?? [],
          isDefault: radarr?.isDefault ?? false,
          is4k: radarr?.is4k ?? false,
          externalUrl: radarr?.externalUrl,
          syncEnabled: radarr?.syncEnabled ?? false,
          enableSearch: !radarr?.preventSearch,
          tagRequests: radarr?.tagRequests ?? false,
        }}
        validationSchema={RadarrSettingsSchema}
        onSubmit={async (values) => {
          try {
            const profileName = testResponse.profiles.find(
              (profile) => profile.id === Number(values.activeProfileId)
            )?.name;

            const submission = {
              name: values.name,
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.ssl,
              baseUrl: values.baseUrl,
              activeProfileId: Number(values.activeProfileId),
              activeProfileName: profileName,
              activeDirectory: values.rootFolder,
              is4k: values.is4k,
              minimumAvailability: values.minimumAvailability,
              tags: values.tags,
              isDefault: values.isDefault,
              externalUrl: values.externalUrl,
              syncEnabled: values.syncEnabled,
              preventSearch: !values.enableSearch,
              tagRequests: values.tagRequests,
            };
            if (!radarr) {
              await axios.post('/api/v1/settings/radarr', submission);
            } else {
              await axios.put(
                `/api/v1/settings/radarr/${radarr.id}`,
                submission
              );
            }

            onSave();
          } catch {
            // set error here
          }
        }}
      >
        {({
          errors,
          touched,
          values,
          handleSubmit,
          setFieldValue,
          isSubmitting,
          isValid,
        }) => {
          return (
            <Modal
              onCancel={onClose}
              okButtonType="primary"
              okText={
                isSubmitting
                  ? intl.formatMessage(globalMessages.saving)
                  : radarr
                    ? intl.formatMessage(globalMessages.save)
                    : intl.formatMessage(messages.add)
              }
              secondaryButtonType="warning"
              secondaryText={
                isTesting
                  ? intl.formatMessage(globalMessages.testing)
                  : intl.formatMessage(globalMessages.test)
              }
              onSecondary={() => {
                if (values.apiKey && values.hostname && values.port) {
                  testConnection({
                    apiKey: values.apiKey,
                    baseUrl: values.baseUrl,
                    hostname: values.hostname,
                    port: values.port,
                    useSsl: values.ssl,
                  });
                  if (!values.baseUrl || values.baseUrl === '/') {
                    setFieldValue('baseUrl', testResponse.urlBase);
                  }
                }
              }}
              secondaryDisabled={
                !values.apiKey ||
                !values.hostname ||
                !values.port ||
                isTesting ||
                isSubmitting
              }
              okDisabled={!isValidated || isSubmitting || isTesting || !isValid}
              onOk={() => handleSubmit()}
              title={
                !radarr
                  ? intl.formatMessage(
                      values.is4k
                        ? messages.create4kradarr
                        : messages.createradarr
                    )
                  : intl.formatMessage(
                      values.is4k ? messages.edit4kradarr : messages.editradarr
                    )
              }
            >
              <div className="mb-6">
                <ArrConnectionFields
                  messages={messages}
                  onConnectionEdit={() => setIsValidated(false)}
                />
                <ArrSelectField
                  name="activeProfileId"
                  label={intl.formatMessage(messages.qualityprofile)}
                  required={true}
                  disabled={!isValidated || isTesting}
                  options={profileOptions}
                  placeholder={intl.formatMessage(
                    isTesting
                      ? messages.loadingprofiles
                      : !isValidated
                        ? messages.testFirstQualityProfiles
                        : messages.selectQualityProfile
                  )}
                />
                <ArrSelectField
                  name="rootFolder"
                  label={intl.formatMessage(messages.rootfolder)}
                  required={true}
                  disabled={!isValidated || isTesting}
                  options={rootFolderOptions}
                  placeholder={intl.formatMessage(
                    isTesting
                      ? messages.loadingrootfolders
                      : !isValidated
                        ? messages.testFirstRootFolders
                        : messages.selectRootFolder
                  )}
                />
                <div className="form-row">
                  <label htmlFor="minimumAvailability" className="text-label">
                    {intl.formatMessage(messages.minimumAvailability)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="minimumAvailability"
                        name="minimumAvailability"
                      >
                        <option value="announced">
                          {intl.formatMessage(messages.announced)}
                        </option>
                        <option value="inCinemas">
                          {intl.formatMessage(messages.inCinemas)}
                        </option>
                        <option value="released">
                          {intl.formatMessage(messages.released)}
                        </option>
                      </Field>
                    </div>
                    {errors.minimumAvailability &&
                      touched.minimumAvailability && (
                        <div className="error">
                          {errors.minimumAvailability}
                        </div>
                      )}
                  </div>
                </div>
                <ArrTagsField
                  name="tags"
                  label={intl.formatMessage(messages.tags)}
                  tags={isValidated ? testResponse.tags : []}
                  disabled={!isValidated}
                  loading={isTesting}
                  hideSelectionWhileLoading={false}
                  placeholder={intl.formatMessage(
                    !isValidated
                      ? messages.testFirstTags
                      : isTesting
                        ? messages.loadingTags
                        : messages.selecttags
                  )}
                  noOptionsLabel={intl.formatMessage(messages.notagoptions)}
                />
                <ArrServiceOptions messages={messages} />
              </div>
            </Modal>
          );
        }}
      </Formik>
    </Transition>
  );
};

export default RadarrModal;
