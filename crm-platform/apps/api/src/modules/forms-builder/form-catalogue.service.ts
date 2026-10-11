import { Injectable } from '@nestjs/common';
import type {
  FieldType,
  FormBindObject,
  FormFieldKind,
  FormPaymentGateway,
  FormProperty,
  FormPropertyList,
  FormTemplateList,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WorkspaceGatewayResolver,
  supportsPaymentLinks,
} from '../checkout-orders-merchant-payments';
import { ContactsRepository } from '../crm';
import { FORM_TEMPLATES } from './form-templates';
import { FormsRepository } from './forms.repository';

interface Builtin {
  property: string;
  label: string;
  type: FieldType;
  kind: FormFieldKind;
}

/** The columns a form can write without a registry entry. Names match `CONTACT_BUILTIN_PROPERTIES` / `COMPANY_BUILTIN_PROPERTIES`. */
const CONTACT_BUILTINS: readonly Builtin[] = [
  { property: 'name', label: 'Full name', type: 'text', kind: 'short_text' },
  { property: 'first_name', label: 'First name', type: 'text', kind: 'short_text' },
  { property: 'last_name', label: 'Last name', type: 'text', kind: 'short_text' },
  { property: 'email', label: 'Email', type: 'email', kind: 'email' },
  { property: 'phone', label: 'Phone', type: 'phone', kind: 'phone' },
  { property: 'title', label: 'Job title', type: 'text', kind: 'short_text' },
  { property: 'address', label: 'Address', type: 'long_text', kind: 'long_text' },
  { property: 'message', label: 'Message', type: 'long_text', kind: 'long_text' },
];
const COMPANY_BUILTINS: readonly Builtin[] = [
  { property: 'name', label: 'Company name', type: 'text', kind: 'short_text' },
  { property: 'domain', label: 'Website', type: 'url', kind: 'short_text' },
  { property: 'email', label: 'Company email', type: 'email', kind: 'email' },
  { property: 'phone', label: 'Company phone', type: 'phone', kind: 'phone' },
  { property: 'industry', label: 'Industry', type: 'text', kind: 'short_text' },
  { property: 'size_range', label: 'Company size', type: 'text', kind: 'short_text' },
  { property: 'address', label: 'Company address', type: 'long_text', kind: 'long_text' },
  { property: 'notes', label: 'Notes', type: 'long_text', kind: 'long_text' },
];

/** The block kind the picker adds for a registry property of each type. */
const KIND_FOR_TYPE: Record<string, FormFieldKind> = {
  text: 'short_text',
  long_text: 'long_text',
  integer: 'number',
  big_integer: 'number',
  decimal: 'number',
  percentage: 'number',
  currency: 'currency',
  boolean: 'checkbox',
  checkbox: 'checkbox',
  radio: 'radio',
  select: 'dropdown',
  multiselect: 'checkbox_group',
  date: 'date',
  url: 'short_text',
  email: 'email',
  phone: 'phone',
  rating: 'rating',
  timezone: 'short_text',
};

/**
 * The field picker's catalogue and the template gallery (docs/specs/forms-builder-app.md 7.1 and 9.3): which CRM properties a field can
 * be bound to. Built-in columns plus every active, writable custom property of the workspace's registry, typed from the registry. A
 * property a visitor must never set (owner, lifecycle stage, tags, formulas, lookups, system and read-only fields) is not offered, and the
 * pipeline ignores a hand-crafted bind to one.
 */
@Injectable()
export class FormCatalogueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FormsRepository,
    private readonly contacts: ContactsRepository,
    private readonly gateways: WorkspaceGatewayResolver,
  ) {}

  async properties(object: FormBindObject): Promise<FormPropertyList> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const builtins = object === 'contact' ? CONTACT_BUILTINS : COMPANY_BUILTINS;
      const taken = new Set(builtins.map((b) => b.property));
      const out: FormProperty[] = builtins.map((b) => ({
        object,
        property: b.property,
        label: b.label,
        source: 'builtin',
        type: b.type,
        suggestedKind: b.kind,
        requiredByWorkspace: false,
      }));
      const custom = await this.repo.registryProperties(
        tx,
        ctx.orgId,
        object === 'contact' ? 'contacts' : 'companies',
      );
      // The workspace's own required rules (with their dependency conditions) are the source for contacts: a conditional rule is not
      // "required" unconditionally, and the form must treat it like the CRM does.
      const rules = object === 'contact' ? await this.contacts.requiredRules(tx, ctx.orgId) : [];
      const required = new Set(rules.filter((r) => r.conditions.length === 0).map((r) => r.key));
      for (const p of custom) {
        if (taken.has(p.key)) continue;
        out.push({
          object,
          property: p.key,
          label: p.label,
          source: 'custom',
          type: p.type as FieldType,
          suggestedKind: KIND_FOR_TYPE[p.type] ?? 'short_text',
          requiredByWorkspace: object === 'contact' ? required.has(p.key) : p.required,
          ...(p.options.length > 0 ? { options: p.options } : {}),
        });
      }
      return { data: out };
    });
  }

  /** Whether the workspace can take payment on a form: the shared gateway (Settings > Payments) must exist and be able to make a hosted link. */
  async paymentGateway(): Promise<FormPaymentGateway> {
    const ctx = RequestContextStore.require();
    const gw = await this.gateways.resolve(ctx.orgId);
    if (!gw) return { ready: false, slug: null, name: null, mode: null, reason: 'none_connected' };
    const ready = supportsPaymentLinks(gw.slug);
    return {
      ready,
      slug: gw.slug,
      name: gw.name,
      mode: gw.mode,
      reason: ready ? null : 'no_link_support',
    };
  }

  templates(): FormTemplateList {
    return { data: [...FORM_TEMPLATES] };
  }
}
