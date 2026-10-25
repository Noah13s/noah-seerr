import SensitiveInput from '@app/components/Common/SensitiveInput';
import globalMessages from '@app/i18n/globalMessages';
import { Field, useField, useFormikContext } from 'formik';
import type { ChangeEvent } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { useIntl } from 'react-intl';
import Select from 'react-select';

// Shared subset of the Radarr/Sonarr forms. Service-specific and anime fields
// remain in their modal; existing message descriptors preserve translations.
interface ArrFormValues {
  name?: string;
  hostname?: string;
  port: number | string;
  ssl: boolean;
  apiKey?: string;
  baseUrl?: string;
  externalUrl?: string;
  isDefault: boolean;
  is4k: boolean;
  syncEnabled: boolean;
  enableSearch: boolean;
  tagRequests: boolean;
}

type ArrMessages = Record<
  | 'qualityprofile'
  | 'rootfolder'
  | 'loadingprofiles'
  | 'testFirstQualityProfiles'
  | 'selectQualityProfile'
  | 'loadingrootfolders'
  | 'testFirstRootFolders'
  | 'selectRootFolder'
  | 'apiKey'
  | 'apiKeyHelp'
  | 'baseUrl'
  | 'baseUrlHelp'
  | 'default4kserver'
  | 'defaultserver'
  | 'enableSearch'
  | 'enableSearchHelp'
  | 'externalUrl'
  | 'externalUrlHelp'
  | 'hostname'
  | 'port'
  | 'server4k'
  | 'server4kHelp'
  | 'servername'
  | 'ssl'
  | 'syncEnabled'
  | 'syncEnabledHelp'
  | 'tagRequests'
  | 'tagRequestsInfo',
  MessageDescriptor
>;

export function ArrConnectionFields({
  messages,
  onConnectionEdit,
}: {
  messages: ArrMessages;
  onConnectionEdit: () => void;
}) {
  const intl = useIntl();
  const { values, errors, touched, handleChange } =
    useFormikContext<ArrFormValues>();
  const handleConnectionChange = (event: ChangeEvent<HTMLInputElement>) => {
    onConnectionEdit();
    handleChange(event);
  };
  return (
    <>
      <div className="form-row">
        <label htmlFor="isDefault" className="checkbox-label">
          {intl.formatMessage(
            values.is4k ? messages.default4kserver : messages.defaultserver
          )}
        </label>
        <div className="form-input-area">
          <Field type="checkbox" id="isDefault" name="isDefault" />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="is4k" className="checkbox-label">
          {intl.formatMessage(messages.server4k)}
          <span className="label-tip">
            {intl.formatMessage(messages.server4kHelp)}
          </span>
        </label>
        <div className="form-input-area">
          <Field type="checkbox" id="is4k" name="is4k" />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="name" className="text-label">
          {intl.formatMessage(messages.servername)}
          <span className="label-required">*</span>
        </label>
        <div className="form-input-area">
          <div className="form-input-field">
            <Field
              id="name"
              name="name"
              type="text"
              autoComplete="off"
              data-form-type="other"
              data-1pignore="true"
              data-lpignore="true"
              data-bwignore="true"
              onChange={handleConnectionChange}
            />
          </div>
          {errors.name && touched.name && typeof errors.name === 'string' && (
            <div className="error">{errors.name}</div>
          )}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="hostname" className="text-label">
          {intl.formatMessage(messages.hostname)}
          <span className="label-required">*</span>
        </label>
        <div className="form-input-area">
          <div className="form-input-field">
            <span className="protocol">
              {values.ssl ? 'https://' : 'http://'}
            </span>
            <Field
              id="hostname"
              name="hostname"
              type="text"
              inputMode="url"
              onChange={handleConnectionChange}
              className="rounded-r-only"
            />
          </div>
          {errors.hostname &&
            touched.hostname &&
            typeof errors.hostname === 'string' && (
              <div className="error">{errors.hostname}</div>
            )}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="port" className="text-label">
          {intl.formatMessage(messages.port)}
          <span className="label-required">*</span>
        </label>
        <div className="form-input-area">
          <Field
            id="port"
            name="port"
            type="text"
            inputMode="numeric"
            className="short"
            onChange={handleConnectionChange}
          />
          {errors.port && touched.port && typeof errors.port === 'string' && (
            <div className="error">{errors.port}</div>
          )}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="ssl" className="checkbox-label">
          {intl.formatMessage(messages.ssl)}
        </label>
        <div className="form-input-area">
          <Field
            type="checkbox"
            id="ssl"
            name="ssl"
            onChange={handleConnectionChange}
          />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="apiKey" className="text-label">
          {intl.formatMessage(messages.apiKey)}
          <span className="label-required">*</span>
          <span className="label-tip">
            {intl.formatMessage(messages.apiKeyHelp)}
          </span>
        </label>
        <div className="form-input-area">
          <div className="form-input-field">
            <SensitiveInput
              as="field"
              id="apiKey"
              name="apiKey"
              onChange={handleConnectionChange}
            />
          </div>
          {errors.apiKey &&
            touched.apiKey &&
            typeof errors.apiKey === 'string' && (
              <div className="error">{errors.apiKey}</div>
            )}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="baseUrl" className="text-label">
          {intl.formatMessage(messages.baseUrl)}
          <span className="label-tip">
            {intl.formatMessage(messages.baseUrlHelp)}
          </span>
        </label>
        <div className="form-input-area">
          <div className="form-input-field">
            <Field
              id="baseUrl"
              name="baseUrl"
              type="text"
              inputMode="url"
              onChange={handleConnectionChange}
            />
          </div>
          {errors.baseUrl &&
            touched.baseUrl &&
            typeof errors.baseUrl === 'string' && (
              <div className="error">{errors.baseUrl}</div>
            )}
        </div>
      </div>
    </>
  );
}

export function ArrServiceOptions({ messages }: { messages: ArrMessages }) {
  const intl = useIntl();
  const { errors, touched } = useFormikContext<ArrFormValues>();
  return (
    <>
      <div className="form-row">
        <label htmlFor="externalUrl" className="text-label">
          {intl.formatMessage(messages.externalUrl)}
          <span className="label-tip">
            {intl.formatMessage(messages.externalUrlHelp)}
          </span>
        </label>
        <div className="form-input-area">
          <div className="form-input-field">
            <Field
              id="externalUrl"
              name="externalUrl"
              type="text"
              inputMode="url"
            />
          </div>
          {errors.externalUrl &&
            touched.externalUrl &&
            typeof errors.externalUrl === 'string' && (
              <div className="error">{errors.externalUrl}</div>
            )}
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="syncEnabled" className="checkbox-label">
          {intl.formatMessage(messages.syncEnabled)}
          <span className="label-tip">
            {intl.formatMessage(messages.syncEnabledHelp)}
          </span>
        </label>
        <div className="form-input-area">
          <Field type="checkbox" id="syncEnabled" name="syncEnabled" />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="enableSearch" className="checkbox-label">
          {intl.formatMessage(messages.enableSearch)}
          <span className="label-tip">
            {intl.formatMessage(messages.enableSearchHelp)}
          </span>
        </label>
        <div className="form-input-area">
          <Field type="checkbox" id="enableSearch" name="enableSearch" />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="tagRequests" className="checkbox-label">
          {intl.formatMessage(messages.tagRequests)}
          <span className="label-tip">
            {intl.formatMessage(messages.tagRequestsInfo)}
          </span>
        </label>
        <div className="form-input-area">
          <Field type="checkbox" id="tagRequests" name="tagRequests" />
        </div>
      </div>
    </>
  );
}

export function ArrSelectField({
  name,
  label,
  placeholder,
  disabled,
  required = false,
  options,
}: {
  name: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  required?: boolean;
  options: readonly { value: number | string; label: string }[];
}) {
  const [, meta] = useField<string | number>(name);
  return (
    <div className="form-row">
      <label htmlFor={name} className="text-label">
        {label}
        {required && <span className="label-required">*</span>}
      </label>
      <div className="form-input-area">
        <div className="form-input-field">
          <Field as="select" id={name} name={name} disabled={disabled}>
            <option value="">{placeholder}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Field>
        </div>
        {meta.touched && meta.error && (
          <div className="error">{meta.error}</div>
        )}
      </div>
    </div>
  );
}

export function arrProfileOptions(
  profiles: readonly { id: number; name: string }[],
  locale: string
) {
  return profiles
    .toSorted((a, b) =>
      a.name.localeCompare(b.name, locale, {
        numeric: true,
        sensitivity: 'base',
      })
    )
    .map((profile) => ({ value: profile.id, label: profile.name }));
}

export function ArrTagsField({
  name,
  label,
  tags,
  disabled,
  loading,
  placeholder,
  noOptionsLabel,
  hideSelectionWhileLoading = false,
}: {
  name: string;
  label: string;
  tags: readonly { id: number; label: string }[];
  disabled: boolean;
  loading: boolean;
  placeholder: string;
  noOptionsLabel: string;
  hideSelectionWhileLoading?: boolean;
}) {
  const intl = useIntl();
  const [field, meta, helpers] = useField<number[]>(name);
  const options = tags.map((tag) => ({ value: tag.id, label: tag.label }));
  const selected = (field.value ?? []).flatMap((id) => {
    const option = options.find((tag) => tag.value === id);
    return option ? [option] : [];
  });
  return (
    <div className="form-row">
      <label htmlFor={name} className="text-label">
        {label}
      </label>
      <div className="form-input-area">
        <Select<{ value: number; label: string }, true>
          inputId={name}
          name={name}
          options={options}
          isMulti
          isDisabled={disabled || loading}
          isLoading={loading}
          placeholder={placeholder}
          className="react-select-container"
          classNamePrefix="react-select"
          value={loading && hideSelectionWhileLoading ? [] : selected}
          onChange={async (value) => {
            try {
              await helpers.setValue(value.map((option) => option.value));
            } catch {
              helpers.setError(intl.formatMessage(globalMessages.error));
            }
          }}
          noOptionsMessage={() => noOptionsLabel}
        />
        {meta.error && <div className="error">{meta.error}</div>}
      </div>
    </div>
  );
}

export function ArrLibraryFields({
  messages,
  profileOptions,
  rootFolderOptions,
  validated,
  loading,
}: {
  messages: ArrMessages;
  profileOptions: readonly { value: number | string; label: string }[];
  rootFolderOptions: readonly { value: number | string; label: string }[];
  validated: boolean;
  loading: boolean;
}) {
  const intl = useIntl();
  return (
    <>
      <ArrSelectField
        name="activeProfileId"
        label={intl.formatMessage(messages.qualityprofile)}
        required
        disabled={!validated || loading}
        options={profileOptions}
        placeholder={intl.formatMessage(
          loading
            ? messages.loadingprofiles
            : !validated
              ? messages.testFirstQualityProfiles
              : messages.selectQualityProfile
        )}
      />
      <ArrSelectField
        name="rootFolder"
        label={intl.formatMessage(messages.rootfolder)}
        required
        disabled={!validated || loading}
        options={rootFolderOptions}
        placeholder={intl.formatMessage(
          loading
            ? messages.loadingrootfolders
            : !validated
              ? messages.testFirstRootFolders
              : messages.selectRootFolder
        )}
      />
    </>
  );
}
