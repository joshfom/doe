'use client';

/**
 * Per–request-type structured forms used by the ticket request editor.
 *
 * Each form receives the current `value` (a Record<string, unknown>) and an
 * `onChange` callback. Forms emit the current shape on every keystroke;
 * server-side Zod validation in `lib/cms/tickets/request-types.ts` is the
 * source of truth, so these components only enforce the most common
 * required fields visually (via `required` + `aria-invalid`).
 *
 * Field names match the Zod schemas exactly so server-returned
 * `requestData.<path>` field errors map cleanly back to inputs.
 */

import { useMemo } from 'react';

type ReqValue = Record<string, unknown>;

interface FormProps {
  value: ReqValue;
  onChange: (next: ReqValue) => void;
  fieldErrors?: Record<string, string>;
}

// ── Tiny field primitives ───────────────────────────────────────────────────

const inputCls =
  'h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm focus:border-ora-gold focus:outline-none';
const labelCls =
  'mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted';
const errCls = 'mt-1 text-[11px] text-ora-error';

function get<T = unknown>(obj: ReqValue, path: string): T | undefined {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj) as T | undefined;
}

function set(obj: ReqValue, path: string, value: unknown): ReqValue {
  const keys = path.split('.');
  const next: ReqValue = { ...obj };
  let cursor: ReqValue = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const existing = cursor[k];
    cursor[k] =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as ReqValue) }
        : {};
    cursor = cursor[k] as ReqValue;
  }
  if (value === '' || value === undefined) {
    delete cursor[keys[keys.length - 1]];
  } else {
    cursor[keys[keys.length - 1]] = value;
  }
  return next;
}

function Text({
  label,
  path,
  value,
  onChange,
  fieldErrors,
  type = 'text',
  required = false,
  placeholder,
  prefix = 'requestData',
}: {
  label: string;
  path: string;
  value: ReqValue;
  onChange: (n: ReqValue) => void;
  fieldErrors?: Record<string, string>;
  type?: string;
  required?: boolean;
  placeholder?: string;
  prefix?: string;
}) {
  const errKey = `${prefix}.${path}`;
  const err = fieldErrors?.[errKey];
  const v = get<string | number>(value, path) ?? '';
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-ora-error">*</span>}
      </label>
      <input
        type={type}
        value={String(v)}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (type === 'number') {
            onChange(set(value, path, raw === '' ? '' : Number(raw)));
          } else {
            onChange(set(value, path, raw));
          }
        }}
        className={inputCls}
        aria-invalid={Boolean(err) || undefined}
      />
      {err && <p className={errCls}>{err}</p>}
    </div>
  );
}

function TextArea({
  label,
  path,
  value,
  onChange,
  fieldErrors,
  rows = 3,
  required = false,
  prefix = 'requestData',
}: {
  label: string;
  path: string;
  value: ReqValue;
  onChange: (n: ReqValue) => void;
  fieldErrors?: Record<string, string>;
  rows?: number;
  required?: boolean;
  prefix?: string;
}) {
  const errKey = `${prefix}.${path}`;
  const err = fieldErrors?.[errKey];
  const v = (get<string>(value, path) ?? '') as string;
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-ora-error">*</span>}
      </label>
      <textarea
        value={v}
        rows={rows}
        onChange={(e) => onChange(set(value, path, e.target.value))}
        className="w-full border border-ora-sand bg-ora-white p-2 text-sm focus:border-ora-gold focus:outline-none"
        aria-invalid={Boolean(err) || undefined}
      />
      {err && <p className={errCls}>{err}</p>}
    </div>
  );
}

function Select({
  label,
  path,
  value,
  onChange,
  options,
  fieldErrors,
  required = false,
  prefix = 'requestData',
}: {
  label: string;
  path: string;
  value: ReqValue;
  onChange: (n: ReqValue) => void;
  options: { value: string; label: string }[];
  fieldErrors?: Record<string, string>;
  required?: boolean;
  prefix?: string;
}) {
  const errKey = `${prefix}.${path}`;
  const err = fieldErrors?.[errKey];
  const v = (get<string>(value, path) ?? '') as string;
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-ora-error">*</span>}
      </label>
      <select
        value={v}
        onChange={(e) => onChange(set(value, path, e.target.value))}
        className={inputCls}
        aria-invalid={Boolean(err) || undefined}
      >
        <option value="">— Select —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {err && <p className={errCls}>{err}</p>}
    </div>
  );
}

function Checkbox({
  label,
  path,
  value,
  onChange,
}: {
  label: string;
  path: string;
  value: ReqValue;
  onChange: (n: ReqValue) => void;
}) {
  const v = Boolean(get<boolean>(value, path));
  return (
    <label className="inline-flex items-center gap-2 text-sm text-ora-charcoal">
      <input
        type="checkbox"
        checked={v}
        onChange={(e) => onChange(set(value, path, e.target.checked))}
        className="h-4 w-4 border-ora-sand"
      />
      {label}
    </label>
  );
}

// ── Sub-form: party (name/phone/email/company) ──────────────────────────────

function PartyFields({
  label,
  basePath,
  value,
  onChange,
  fieldErrors,
  requireName = true,
}: {
  label: string;
  basePath: string;
  value: ReqValue;
  onChange: (n: ReqValue) => void;
  fieldErrors?: Record<string, string>;
  requireName?: boolean;
}) {
  return (
    <div className="space-y-3 border border-ora-sand/60 bg-ora-cream/30 p-3">
      <p className="text-xs font-semibold text-ora-charcoal">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Name"
          path={`${basePath}.name`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required={requireName}
        />
        <Text
          label="Company"
          path={`${basePath}.company`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Phone"
          path={`${basePath}.phone`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Email"
          path={`${basePath}.email`}
          type="email"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Emirates ID"
          path={`${basePath}.emiratesId`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      </div>
    </div>
  );
}

function VehicleFields({
  label,
  basePath,
  value,
  onChange,
  fieldErrors,
}: {
  label: string;
  basePath: string;
  value: ReqValue;
  onChange: (n: ReqValue) => void;
  fieldErrors?: Record<string, string>;
}) {
  return (
    <div className="space-y-3 border border-ora-sand/60 bg-ora-cream/30 p-3">
      <p className="text-xs font-semibold text-ora-charcoal">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Plate number"
          path={`${basePath}.plateNumber`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
        <Text
          label="Emirate"
          path={`${basePath}.emirate`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Make"
          path={`${basePath}.make`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Model"
          path={`${basePath}.model`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Color"
          path={`${basePath}.color`}
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      </div>
    </div>
  );
}

// ── Per-type forms ──────────────────────────────────────────────────────────

function GeneralInquiryForm({ value, onChange, fieldErrors }: FormProps) {
  return (
    <div className="space-y-4">
      <TextArea
        label="Notes"
        path="notes"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        rows={4}
      />
    </div>
  );
}

function NocForm({ value, onChange, fieldErrors }: FormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="NOC type"
          path="nocType"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
          options={[
            { value: 'fit_out', label: 'Fit-out' },
            { value: 'renovation', label: 'Renovation' },
            { value: 'modification', label: 'Modification' },
            { value: 'utility_connection', label: 'Utility connection' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Text
          label="Estimated cost (AED)"
          path="estimatedCost"
          type="number"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      </div>
      <TextArea
        label="Work description"
        path="workDescription"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Planned start date"
          path="plannedStartDate"
          type="date"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
        <Text
          label="Planned end date"
          path="plannedEndDate"
          type="date"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
      </div>
      <PartyFields
        label="Contractor (optional)"
        basePath="contractor"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        requireName={false}
      />
    </div>
  );
}

function MoveInForm({ value, onChange, fieldErrors }: FormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Direction"
          path="direction"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          options={[
            { value: 'in', label: 'Move-in' },
            { value: 'out', label: 'Move-out' },
          ]}
        />
        <Text
          label="Move date"
          path="moveDate"
          type="date"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Window start"
          path="moveWindow.start"
          type="time"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Window end"
          path="moveWindow.end"
          type="time"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Crew size"
          path="crewSize"
          type="number"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Truck plates (comma-separated)"
          path="truckPlatesRaw"
          value={value}
          onChange={(next) => {
            const raw = (get<string>(next, 'truckPlatesRaw') ?? '') as string;
            const plates = raw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(set(next, 'truckPlates', plates));
          }}
          fieldErrors={fieldErrors}
        />
      </div>
      <Text
        label="Access route"
        path="accessRoute"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
      <TextArea
        label="Items"
        path="items"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
      <PartyFields
        label="Mover company (optional)"
        basePath="moverCompany"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        requireName={false}
      />
    </div>
  );
}

function GatePassForm({ value, onChange, fieldErrors }: FormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Pass type"
          path="passType"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
          options={[
            { value: 'visitor', label: 'Visitor' },
            { value: 'delivery', label: 'Delivery' },
            { value: 'contractor', label: 'Contractor' },
            { value: 'vendor', label: 'Vendor' },
          ]}
        />
        <Text
          label="Accompanying persons"
          path="accompanyingPersons"
          type="number"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      </div>
      <Text
        label="Purpose"
        path="purpose"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Valid from"
          path="validFrom"
          type="datetime-local"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
        <Text
          label="Valid until"
          path="validUntil"
          type="datetime-local"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
      </div>
      <Checkbox
        label="Allow multiple entries"
        path="multipleEntries"
        value={value}
        onChange={onChange}
      />
      <PartyFields
        label="Visitor"
        basePath="visitor"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
      <VehicleFields
        label="Vehicle (optional)"
        basePath="vehicle"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
    </div>
  );
}

function TechnicianVisitForm({ value, onChange, fieldErrors }: FormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Discipline"
          path="discipline"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
          options={[
            { value: 'ac', label: 'AC' },
            { value: 'plumbing', label: 'Plumbing' },
            { value: 'electrical', label: 'Electrical' },
            { value: 'carpentry', label: 'Carpentry' },
            { value: 'appliance', label: 'Appliance' },
            { value: 'pest_control', label: 'Pest control' },
            { value: 'general', label: 'General' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </div>
      <TextArea
        label="Issue summary"
        path="issueSummary"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Preferred window — start"
          path="preferredWindow.start"
          type="datetime-local"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Preferred window — end"
          path="preferredWindow.end"
          type="datetime-local"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      </div>
      <TextArea
        label="Access instructions"
        path="accessInstructions"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
    </div>
  );
}

function ConstructionDeliveryForm({ value, onChange, fieldErrors }: FormProps) {
  const materials = useMemo(() => {
    const m = get<unknown[]>(value, 'materials');
    return Array.isArray(m) ? (m as ReqValue[]) : [];
  }, [value]);

  function updateMaterial(idx: number, field: string, raw: string) {
    const next = [...materials];
    const item = { ...(next[idx] ?? {}) } as ReqValue;
    if (field === 'quantity') {
      if (raw === '') delete item.quantity;
      else item.quantity = Number(raw);
    } else if (raw === '') {
      delete item[field];
    } else {
      item[field] = raw;
    }
    next[idx] = item;
    onChange(set(value, 'materials', next));
  }

  function addMaterial() {
    onChange(set(value, 'materials', [...materials, { name: '' }]));
  }

  function removeMaterial(idx: number) {
    const next = materials.filter((_, i) => i !== idx);
    onChange(set(value, 'materials', next));
  }

  return (
    <div className="space-y-4">
      <PartyFields
        label="Vendor"
        basePath="vendor"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />

      <div className="space-y-2 border border-ora-sand/60 bg-ora-cream/30 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-ora-charcoal">
            Materials<span className="ml-0.5 text-ora-error">*</span>
          </p>
          <button
            type="button"
            onClick={addMaterial}
            className="border border-ora-sand bg-ora-white px-3 py-1 text-xs hover:bg-ora-cream"
          >
            + Add material
          </button>
        </div>
        {materials.length === 0 && (
          <p className="text-xs text-ora-muted">No materials added.</p>
        )}
        {materials.map((m, idx) => (
          <div
            key={idx}
            className="grid grid-cols-[1fr_100px_100px_auto] gap-2 items-end"
          >
            <div>
              <label className={labelCls}>Name</label>
              <input
                value={String(m.name ?? '')}
                onChange={(e) => updateMaterial(idx, 'name', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Qty</label>
              <input
                type="number"
                value={m.quantity == null ? '' : String(m.quantity)}
                onChange={(e) => updateMaterial(idx, 'quantity', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Unit</label>
              <input
                value={String(m.unit ?? '')}
                onChange={(e) => updateMaterial(idx, 'unit', e.target.value)}
                className={inputCls}
              />
            </div>
            <button
              type="button"
              onClick={() => removeMaterial(idx)}
              className="h-10 border border-ora-sand bg-ora-white px-3 text-xs text-ora-error hover:bg-ora-error/10"
            >
              Remove
            </button>
          </div>
        ))}
        {fieldErrors?.['requestData.materials'] && (
          <p className={errCls}>{fieldErrors['requestData.materials']}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Delivery date"
          path="deliveryDate"
          type="date"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
        <Checkbox
          label="Requires lift access"
          path="requiresLift"
          value={value}
          onChange={onChange}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Window start"
          path="deliveryWindow.start"
          type="time"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
        <Text
          label="Window end"
          path="deliveryWindow.end"
          type="time"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      </div>
      <TextArea
        label="Notes"
        path="notes"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
      <VehicleFields
        label="Vehicle (optional)"
        basePath="vehicle"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
    </div>
  );
}

function VendorAccessForm({ value, onChange, fieldErrors }: FormProps) {
  return (
    <div className="space-y-4">
      <PartyFields
        label="Vendor"
        basePath="vendor"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
      <TextArea
        label="Purpose"
        path="purpose"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Text
          label="Access from"
          path="accessFrom"
          type="datetime-local"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
        <Text
          label="Access until"
          path="accessUntil"
          type="datetime-local"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
        />
      </div>
      <Text
        label="Insurance certificate ID (UUID)"
        path="insuranceCertificateId"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
      />
    </div>
  );
}

function MaintenanceRequestForm({ value, onChange, fieldErrors }: FormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Area"
          path="area"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
          options={[
            { value: 'kitchen', label: 'Kitchen' },
            { value: 'bathroom', label: 'Bathroom' },
            { value: 'bedroom', label: 'Bedroom' },
            { value: 'living_room', label: 'Living room' },
            { value: 'balcony', label: 'Balcony' },
            { value: 'common_area', label: 'Common area' },
            { value: 'exterior', label: 'Exterior' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <Select
          label="Severity"
          path="severity"
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
          required
          options={[
            { value: 'cosmetic', label: 'Cosmetic' },
            { value: 'minor', label: 'Minor' },
            { value: 'major', label: 'Major' },
            { value: 'emergency', label: 'Emergency' },
          ]}
        />
      </div>
      <TextArea
        label="Description"
        path="description"
        value={value}
        onChange={onChange}
        fieldErrors={fieldErrors}
        required
      />
      <Checkbox
        label="Item is under warranty"
        path="underWarranty"
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

// ── Switcher ────────────────────────────────────────────────────────────────

export function RequestDataForm({
  requestType,
  value,
  onChange,
  fieldErrors,
}: {
  requestType: string;
  value: ReqValue;
  onChange: (next: ReqValue) => void;
  fieldErrors?: Record<string, string>;
}) {
  switch (requestType) {
    case 'noc':
      return <NocForm value={value} onChange={onChange} fieldErrors={fieldErrors} />;
    case 'move_in':
    case 'move_out':
      return <MoveInForm value={value} onChange={onChange} fieldErrors={fieldErrors} />;
    case 'gate_pass':
      return <GatePassForm value={value} onChange={onChange} fieldErrors={fieldErrors} />;
    case 'technician_visit':
      return (
        <TechnicianVisitForm
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      );
    case 'construction_material_delivery':
      return (
        <ConstructionDeliveryForm
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      );
    case 'vendor_access':
      return (
        <VendorAccessForm value={value} onChange={onChange} fieldErrors={fieldErrors} />
      );
    case 'maintenance_request':
      return (
        <MaintenanceRequestForm
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      );
    case 'general_inquiry':
    default:
      return (
        <GeneralInquiryForm
          value={value}
          onChange={onChange}
          fieldErrors={fieldErrors}
        />
      );
  }
}
