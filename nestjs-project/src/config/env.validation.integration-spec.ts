import type { ValidationResult } from 'joi';
import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ACCESS_KEY: 'storage-access-key',
  STORAGE_SECRET_KEY: 'storage-secret-key',
};

/**
 * `Joi.object({...})` is an `ObjectSchema<any>`, so `validate()` hands back an
 * `any` value. Annotating the result keeps the assertions below type-checked.
 */
const validate = (
  env: Record<string, string>,
): ValidationResult<Record<string, string>> =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    // Joi's result is a union: `value` is only typed on the success arm, so it
    // has to be narrowed on `error` before being read.
    if (result.error) throw result.error;
    expect(result.value.SWAGGER_ENABLED).toBe('false');
  });
});
