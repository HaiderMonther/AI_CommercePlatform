import { Prisma } from '@prisma/client';
import { TENANT_EXEMPT_MODELS, TENANT_SCOPED_MODELS } from './tenant-scope';

/**
 * Guard test for the multi-tenant contract.
 *
 * Adding a model to schema.prisma without deciding whether it is tenant-owned is the
 * single easiest way to introduce a cross-tenant leak, so every model must appear in
 * exactly one of the two lists.
 */
describe('tenant scope classification', () => {
  const schemaModels = Prisma.dmmf.datamodel.models.map((model) => model.name);

  it('classifies every Prisma model as tenant-scoped or explicitly exempt', () => {
    const classified = new Set<string>([
      ...Object.keys(TENANT_SCOPED_MODELS),
      ...TENANT_EXEMPT_MODELS,
    ]);

    const unclassified = schemaModels.filter((model) => !classified.has(model));

    expect(unclassified).toEqual([]);
  });

  it('does not classify models that no longer exist in the schema', () => {
    const stale = [...Object.keys(TENANT_SCOPED_MODELS), ...TENANT_EXEMPT_MODELS].filter(
      (model) => !schemaModels.includes(model),
    );

    expect(stale).toEqual([]);
  });

  it('points every tenant-scoped model at a column that actually exists', () => {
    const mismatches: string[] = [];

    for (const [modelName, field] of Object.entries(TENANT_SCOPED_MODELS)) {
      const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
      if (!model?.fields.some((item) => item.name === field)) {
        mismatches.push(`${modelName}.${field}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('keeps a companyId column on every model scoped through companyId', () => {
    const missing = Object.entries(TENANT_SCOPED_MODELS)
      .filter(([, field]) => field === 'companyId')
      .filter(([modelName]) => {
        const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
        return !model?.fields.some((item) => item.name === 'companyId');
      })
      .map(([modelName]) => modelName);

    expect(missing).toEqual([]);
  });
});
