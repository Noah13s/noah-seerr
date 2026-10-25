import Modal from '@app/components/Common/Modal';
import {
  ArrConnectionFields,
  ArrSelectField,
  ArrServiceOptions,
  ArrTagsField,
  arrProfileOptions,
} from '@app/components/Settings/ArrFormFields';
import type { SonarrTestResponse } from '@app/components/Settings/SettingsServices';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { Transition } from '@headlessui/react';
import type { SonarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.SonarrModal', {
  createsonarr: 'Add New Sonarr Server',
  create4ksonarr: 'Add New 4K Sonarr Server',
  editsonarr: 'Edit Sonarr Server',
  edit4ksonarr: 'Edit 4K Sonarr Server',
  validationNameRequired: 'You must provide a server name',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  validationRootFolderRequired: 'You must select a root folder',
  validationProfileRequired: 'You must select a quality profile',
  validationLanguageProfileRequired: 'You must select a language profile',
  toastSonarrTestSuccess: 'Sonarr connection established successfully!',
  toastSonarrTestFailure: 'Failed to connect to Sonarr.',
  add: 'Add Server',
  defaultserver: 'Default Server',
  default4kserver: 'Default 4K Server',
  servername: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  baseUrl: 'URL Base',
  qualityprofile: 'Quality Profile',
  languageprofile: 'Language Profile',
  rootfolder: 'Root Folder',
  seriesType: 'Series Type',
  animeSeriesType: 'Anime Series Type',
  animequalityprofile: 'Anime Quality Profile',
  animelanguageprofile: 'Anime Language Profile',
  animerootfolder: 'Anime Root Folder',
  seasonfolders: 'Season Folders',
  server4k: '4K Server',
  server4kHelp:
    'Only if you have a separate 4K instance. Leave unchecked for a single server.',
  selectQualityProfile: 'Select quality profile',
  selectRootFolder: 'Select root folder',
  selectLanguageProfile: 'Select language profile',
  loadingprofiles: 'Loading quality profiles…',
  testFirstQualityProfiles: 'Test connection to load quality profiles',
  loadingrootfolders: 'Loading root folders…',
  testFirstRootFolders: 'Test connection to load root folders',
  loadinglanguageprofiles: 'Loading language profiles…',
  testFirstLanguageProfiles: 'Test connection to load language profiles',
  loadingTags: 'Loading tags…',
  testFirstTags: 'Test connection to load tags',
  syncEnabled: 'Enable Scan',
  externalUrl: 'External URL',
  enableSearch: 'Enable Automatic Search',
  tagRequests: 'Tag Requests',
  tagRequestsInfo:
    "Automatically add an additional tag with the requester's user ID & display name",
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationBaseUrlLeadingSlash: 'Base URL must have a leading slash',
  validationBaseUrlTrailingSlash: 'Base URL must not end in a trailing slash',
  tags: 'Tags',
  animeTags: 'Anime Tags',
  notagoptions: 'No tags.',
  selecttags: 'Select tags',
  monitorNewItems: 'Monitor New Seasons',
  monitorNewItemsHelp:
    'Whether Sonarr should monitor (All) or not (None) new seasons when a series is added.',
  apiKeyHelp: 'Find it in Sonarr: Settings > General > Security > API Key',
  baseUrlHelp:
    'If you set a URL Base in Sonarr (Settings > General > Host), enter it here (e.g. /sonarr). Leave blank otherwise.',
  externalUrlHelp:
    'For clickable links on media pages when the hostname is not reachable from outside your network.',
  syncEnabledHelp:
    'Scan Sonarr for existing media and request status so users cannot request content already available.',
  enableSearchHelp:
    'Automatically trigger a search in Sonarr when a request is approved.',
});

interface SonarrModalProps {
  sonarr: SonarrSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const SonarrModal = ({ onClose, sonarr, onSave }: SonarrModalProps) => {
  const intl = useIntl();
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(sonarr ? true : false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResponse, setTestResponse] = useState<SonarrTestResponse>({
    profiles: [],
    rootFolders: [],
    languageProfiles: null,
    tags: [],
  });

  const profileOptions = arrProfileOptions(testResponse.profiles, intl.locale);
  const rootFolderOptions = testResponse.rootFolders.map((folder) => ({
    value: folder.path,
    label: folder.path,
  }));

  const languageProfileOptions =
    testResponse.languageProfiles?.map((language) => ({
      value: language.id,
      label: language.name,
    })) ?? [];

  const SonarrSettingsSchema = Yup.object().shape({
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
    activeLanguageProfileId: testResponse.languageProfiles
      ? Yup.number().required(
          intl.formatMessage(messages.validationLanguageProfileRequired)
        )
      : Yup.number(),
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
        const response = await axios.post<SonarrTestResponse>(
          '/api/v1/settings/sonarr/test',
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
          addToast(intl.formatMessage(messages.toastSonarrTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
      } catch {
        setIsValidated(false);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastSonarrTestFailure), {
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
    if (sonarr) {
      testConnection({
        apiKey: sonarr.apiKey,
        hostname: sonarr.hostname,
        port: sonarr.port,
        baseUrl: sonarr.baseUrl,
        useSsl: sonarr.useSsl,
      });
    }
  }, [sonarr, testConnection]);

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
          name: sonarr?.name,
          hostname: sonarr?.hostname,
          port: sonarr?.port ?? 8989,
          ssl: sonarr?.useSsl ?? false,
          apiKey: sonarr?.apiKey,
          baseUrl: sonarr?.baseUrl,
          activeProfileId: sonarr?.activeProfileId,
          activeLanguageProfileId: sonarr?.activeLanguageProfileId,
          rootFolder: sonarr?.activeDirectory,
          seriesType: sonarr?.seriesType,
          animeSeriesType: sonarr?.animeSeriesType ?? 'anime',
          activeAnimeProfileId: sonarr?.activeAnimeProfileId,
          activeAnimeLanguageProfileId: sonarr?.activeAnimeLanguageProfileId,
          activeAnimeRootFolder: sonarr?.activeAnimeDirectory,
          tags: sonarr?.tags ?? [],
          animeTags: sonarr?.animeTags ?? [],
          isDefault: sonarr?.isDefault ?? false,
          is4k: sonarr?.is4k ?? false,
          enableSeasonFolders: sonarr?.enableSeasonFolders ?? false,
          externalUrl: sonarr?.externalUrl,
          syncEnabled: sonarr?.syncEnabled ?? false,
          enableSearch: !sonarr?.preventSearch,
          tagRequests: sonarr?.tagRequests ?? false,
          monitorNewItems: sonarr?.monitorNewItems ?? 'all',
        }}
        validationSchema={SonarrSettingsSchema}
        onSubmit={async (values) => {
          try {
            const profileName = testResponse.profiles.find(
              (profile) => profile.id === Number(values.activeProfileId)
            )?.name;
            const animeProfileName = testResponse.profiles.find(
              (profile) => profile.id === Number(values.activeAnimeProfileId)
            )?.name;

            const submission = {
              name: values.name,
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.ssl,
              baseUrl: values.baseUrl,
              activeProfileId: Number(values.activeProfileId),
              activeLanguageProfileId: values.activeLanguageProfileId
                ? Number(values.activeLanguageProfileId)
                : undefined,
              activeProfileName: profileName,
              activeDirectory: values.rootFolder,
              seriesType: values.seriesType,
              animeSeriesType: values.animeSeriesType,
              activeAnimeProfileId: values.activeAnimeProfileId
                ? Number(values.activeAnimeProfileId)
                : undefined,
              activeAnimeLanguageProfileId: values.activeAnimeLanguageProfileId
                ? Number(values.activeAnimeLanguageProfileId)
                : undefined,
              activeAnimeProfileName: animeProfileName ?? undefined,
              activeAnimeDirectory: values.activeAnimeRootFolder,
              tags: values.tags,
              animeTags: values.animeTags,
              is4k: values.is4k,
              isDefault: values.isDefault,
              enableSeasonFolders: values.enableSeasonFolders,
              externalUrl: values.externalUrl,
              syncEnabled: values.syncEnabled,
              preventSearch: !values.enableSearch,
              tagRequests: values.tagRequests,
              monitorNewItems: values.monitorNewItems,
            };
            if (!sonarr) {
              await axios.post('/api/v1/settings/sonarr', submission);
            } else {
              await axios.put(
                `/api/v1/settings/sonarr/${sonarr.id}`,
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
                  : sonarr
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
                !sonarr
                  ? intl.formatMessage(
                      values.is4k
                        ? messages.create4ksonarr
                        : messages.createsonarr
                    )
                  : intl.formatMessage(
                      values.is4k ? messages.edit4ksonarr : messages.editsonarr
                    )
              }
            >
              <div className="mb-6">
                <ArrConnectionFields
                  messages={messages}
                  onConnectionEdit={() => setIsValidated(false)}
                />
                <div className="form-row">
                  <label htmlFor="seriesType" className="text-label">
                    {intl.formatMessage(messages.seriesType)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="seriesType"
                        name="seriesType"
                        disabled={!isValidated || isTesting}
                      >
                        <option value="standard">Standard</option>
                        <option value="daily">Daily</option>
                      </Field>
                    </div>
                  </div>
                  {errors.seriesType && touched.seriesType && (
                    <div className="error">{errors.seriesType}</div>
                  )}
                </div>
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
                {testResponse.languageProfiles && (
                  <ArrSelectField
                    name="activeLanguageProfileId"
                    label={intl.formatMessage(messages.languageprofile)}
                    required={true}
                    disabled={!isValidated || isTesting}
                    options={languageProfileOptions}
                    placeholder={intl.formatMessage(
                      isTesting
                        ? messages.loadinglanguageprofiles
                        : !isValidated
                          ? messages.testFirstLanguageProfiles
                          : messages.selectLanguageProfile
                    )}
                  />
                )}
                <ArrTagsField
                  name="tags"
                  label={intl.formatMessage(messages.tags)}
                  tags={isValidated ? testResponse.tags : []}
                  disabled={!isValidated}
                  loading={isTesting}
                  hideSelectionWhileLoading={true}
                  placeholder={intl.formatMessage(
                    !isValidated
                      ? messages.testFirstTags
                      : isTesting
                        ? messages.loadingTags
                        : messages.selecttags
                  )}
                  noOptionsLabel={intl.formatMessage(messages.notagoptions)}
                />
                <div className="form-row">
                  <label htmlFor="animeSeriesType" className="text-label">
                    {intl.formatMessage(messages.animeSeriesType)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="animeSeriesType"
                        name="animeSeriesType"
                        disabled={!isValidated || isTesting}
                      >
                        <option value="anime">Anime</option>
                        <option value="standard">Standard</option>
                      </Field>
                    </div>
                  </div>
                  {errors.animeSeriesType && touched.animeSeriesType && (
                    <div className="error">{errors.animeSeriesType}</div>
                  )}
                </div>
                <ArrSelectField
                  name="activeAnimeProfileId"
                  label={intl.formatMessage(messages.animequalityprofile)}
                  required={false}
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
                  name="activeAnimeRootFolder"
                  label={intl.formatMessage(messages.animerootfolder)}
                  required={false}
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
                {testResponse.languageProfiles && (
                  <ArrSelectField
                    name="activeAnimeLanguageProfileId"
                    label={intl.formatMessage(messages.animelanguageprofile)}
                    required={false}
                    disabled={!isValidated || isTesting}
                    options={languageProfileOptions}
                    placeholder={intl.formatMessage(
                      isTesting
                        ? messages.loadinglanguageprofiles
                        : !isValidated
                          ? messages.testFirstLanguageProfiles
                          : messages.selectLanguageProfile
                    )}
                  />
                )}
                <ArrTagsField
                  name="animeTags"
                  label={intl.formatMessage(messages.animeTags)}
                  tags={isValidated ? testResponse.tags : []}
                  disabled={!isValidated}
                  loading={isTesting}
                  hideSelectionWhileLoading={true}
                  placeholder={intl.formatMessage(
                    !isValidated
                      ? messages.testFirstTags
                      : isTesting
                        ? messages.loadingTags
                        : messages.selecttags
                  )}
                  noOptionsLabel={intl.formatMessage(messages.notagoptions)}
                />
                <div className="form-row">
                  <label
                    htmlFor="enableSeasonFolders"
                    className="checkbox-label"
                  >
                    {intl.formatMessage(messages.seasonfolders)}
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="enableSeasonFolders"
                      name="enableSeasonFolders"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="monitorNewItems" className="text-label">
                    {intl.formatMessage(messages.monitorNewItems)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.monitorNewItemsHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="monitorNewItems"
                        name="monitorNewItems"
                        disabled={!isValidated || isTesting}
                      >
                        <option value="all">All</option>
                        <option value="none">None</option>
                      </Field>
                    </div>
                  </div>
                  {errors.monitorNewItems && touched.monitorNewItems && (
                    <div className="error">{errors.monitorNewItems}</div>
                  )}
                </div>
                <ArrServiceOptions messages={messages} />
              </div>
            </Modal>
          );
        }}
      </Formik>
    </Transition>
  );
};

export default SonarrModal;
