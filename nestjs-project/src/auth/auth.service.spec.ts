import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import authConfig from '../config/auth.config';
import {
  EmailAlreadyExistsException,
  EmailNotConfirmedException,
  InvalidCredentialsException,
  InvalidTokenException,
  TokenExpiredException,
  TokenReuseDetectedException,
} from '../common/exceptions/domain.exception';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import {
  VerificationToken,
  VerificationTokenType,
} from './entities/verification-token.entity';

const mockAuthConfig = {
  jwtSecret: 'test-secret',
  jwtRefreshSecret: 'test-refresh-secret',
  jwtAccessExpiration: '15m',
  jwtRefreshExpiration: '7d',
  confirmationTokenExpirationHours: 1,
  passwordResetTokenExpirationHours: 1,
};

/**
 * `User.channel` / `Channel.user` are relations the mocked query paths never
 * load. The casts keep each fixture typed as the real entity without widening
 * the whole literal to `any`.
 */
const UNLOADED_CHANNEL = undefined as unknown as Channel;
const UNLOADED_USER = undefined as unknown as User;

function buildChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'channel-1',
    name: 'nick',
    nickname: 'nick',
    description: null,
    user_id: 'u1',
    created_at: new Date(),
    updated_at: new Date(),
    user: UNLOADED_USER,
    ...overrides,
  };
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'user@example.com',
    password: 'hashed-password',
    is_confirmed: true,
    created_at: new Date(),
    updated_at: new Date(),
    channel: UNLOADED_CHANNEL,
    ...overrides,
  };
}

function buildVerificationToken(
  overrides: Partial<VerificationToken> = {},
): VerificationToken {
  return {
    id: 'verification-token-1',
    token_hash: 'hash',
    type: VerificationTokenType.EMAIL_CONFIRMATION,
    user_id: 'u1',
    expires_at: new Date(Date.now() + 60_000),
    used_at: null,
    created_at: new Date(),
    user: UNLOADED_USER,
    ...overrides,
  };
}

function buildRefreshToken(
  overrides: Partial<RefreshToken> = {},
): RefreshToken {
  return {
    id: 'refresh-token-1',
    token_hash: 'hash',
    family: 'family-uuid',
    user_id: 'u1',
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: null,
    created_at: new Date(),
    user: UNLOADED_USER,
    ...overrides,
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * The mocks are held as standalone function references rather than being read
 * back off the injected instances: asserting on a plain mock keeps the
 * expectations free of unbound-method access, while
 * `jest.MockedFunction<Service['method']>` preserves the real signature so
 * `mockResolvedValue` stays type-checked.
 *
 * `Repository.create`/`save`/`createQueryBuilder` are overloaded, which
 * `MockedFunction` cannot represent, so those stay plain `jest.Mock`.
 */
type UsersServiceMocks = {
  findByEmail: jest.MockedFunction<UsersService['findByEmail']>;
  findByEmailWithChannel: jest.MockedFunction<
    UsersService['findByEmailWithChannel']
  >;
  createUserWithChannel: jest.MockedFunction<
    UsersService['createUserWithChannel']
  >;
  save: jest.MockedFunction<UsersService['save']>;
};

type MailServiceMocks = {
  sendConfirmationEmail: jest.MockedFunction<
    MailService['sendConfirmationEmail']
  >;
  sendPasswordResetEmail: jest.MockedFunction<
    MailService['sendPasswordResetEmail']
  >;
};

type RepositoryMocks<T extends { id: string }> = {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.MockedFunction<Repository<T>['findOne']>;
  createQueryBuilder: jest.Mock;
};

type QueryBuilderMocks = {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  execute: jest.Mock;
};

type AuthMocks = {
  usersService: UsersServiceMocks;
  mailService: MailServiceMocks;
  verificationTokenRepository: RepositoryMocks<VerificationToken>;
  refreshTokenRepository: RepositoryMocks<RefreshToken>;
};

function buildQueryBuilderMock(): QueryBuilderMocks {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
}

function buildMocks(): AuthMocks {
  return {
    usersService: {
      findByEmail: jest.fn(),
      findByEmailWithChannel: jest.fn(),
      createUserWithChannel: jest.fn(),
      save: jest.fn(),
    },
    mailService: {
      sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    },
    verificationTokenRepository: {
      create: jest.fn(),
      save: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    },
    refreshTokenRepository: {
      create: jest.fn().mockReturnValue(buildRefreshToken()),
      save: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    },
  };
}

function buildTestModule(mocks: AuthMocks) {
  return Test.createTestingModule({
    imports: [
      JwtModule.register({
        secret: 'test-secret',
        signOptions: { expiresIn: '15m' },
      }),
    ],
    providers: [
      AuthService,
      { provide: UsersService, useValue: mocks.usersService },
      { provide: MailService, useValue: mocks.mailService },
      {
        provide: getRepositoryToken(VerificationToken),
        useValue: mocks.verificationTokenRepository,
      },
      {
        provide: getRepositoryToken(RefreshToken),
        useValue: mocks.refreshTokenRepository,
      },
      { provide: authConfig.KEY, useValue: mockAuthConfig },
    ],
  }).compile();
}

describe('AuthService — register', () => {
  let authService: AuthService;
  let mocks: AuthMocks;

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('throws EmailAlreadyExistsException when email is already registered', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(
      buildUser({ id: 'u1', email: 'test@example.com' }),
    );

    await expect(
      authService.register({
        email: 'test@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(EmailAlreadyExistsException);
  });

  it('hashes the password before creating the user', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(null);
    mocks.usersService.createUserWithChannel.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'new@example.com',
        channel: buildChannel({ name: 'new' }),
      }),
    );
    mocks.verificationTokenRepository.create.mockReturnValue(
      buildVerificationToken(),
    );

    await authService.register({
      email: 'new@example.com',
      password: 'plaintext',
    });

    const [, hashedPassword] =
      mocks.usersService.createUserWithChannel.mock.calls[0];
    expect(hashedPassword).not.toBe('plaintext');
    expect(hashedPassword).toMatch(/^\$argon2/);
  });

  it('calls createUserWithChannel with the correct email', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(null);
    mocks.usersService.createUserWithChannel.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'new@example.com',
        channel: buildChannel({ name: 'new' }),
      }),
    );
    mocks.verificationTokenRepository.create.mockReturnValue(
      buildVerificationToken(),
    );

    await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(mocks.usersService.createUserWithChannel).toHaveBeenCalledWith(
      'new@example.com',
      expect.any(String),
    );
  });

  it('stores a verification token with EMAIL_CONFIRMATION type', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(null);
    mocks.usersService.createUserWithChannel.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'new@example.com',
        channel: buildChannel({ name: 'new' }),
      }),
    );
    const createdToken = buildVerificationToken({
      type: VerificationTokenType.EMAIL_CONFIRMATION,
    });
    mocks.verificationTokenRepository.create.mockReturnValue(createdToken);

    await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(mocks.verificationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: VerificationTokenType.EMAIL_CONFIRMATION,
        user_id: 'u1',
      }),
    );
    expect(mocks.verificationTokenRepository.save).toHaveBeenCalledWith(
      createdToken,
    );
  });

  it('sends a confirmation email with the raw token', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(null);
    mocks.usersService.createUserWithChannel.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'new@example.com',
        channel: buildChannel({ name: 'mynick' }),
      }),
    );
    mocks.verificationTokenRepository.create.mockReturnValue(
      buildVerificationToken(),
    );

    await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(mocks.mailService.sendConfirmationEmail).toHaveBeenCalledWith(
      'new@example.com',
      'mynick',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it('returns the user id and email', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(null);
    mocks.usersService.createUserWithChannel.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'new@example.com',
        channel: buildChannel({ name: 'new' }),
      }),
    );
    mocks.verificationTokenRepository.create.mockReturnValue(
      buildVerificationToken(),
    );

    const result = await authService.register({
      email: 'new@example.com',
      password: 'password123',
    });

    expect(result).toEqual({ id: 'u1', email: 'new@example.com' });
  });
});

describe('AuthService — confirm', () => {
  let authService: AuthService;
  let mocks: AuthMocks;

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('marks user as confirmed and token as used for a valid token', async () => {
    const rawToken = 'a'.repeat(64);
    const user = buildUser({ id: 'u1', is_confirmed: false });
    const record = buildVerificationToken({
      token_hash: sha256(rawToken),
      type: VerificationTokenType.EMAIL_CONFIRMATION,
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
      user,
    });

    mocks.verificationTokenRepository.findOne.mockResolvedValue(record);

    await authService.confirm(rawToken);

    expect(record.used_at).toBeInstanceOf(Date);
    expect(user.is_confirmed).toBe(true);
    expect(mocks.verificationTokenRepository.save).toHaveBeenCalledWith(record);
    expect(mocks.usersService.save).toHaveBeenCalledWith(user);
  });

  it('throws InvalidTokenException when token is not found', async () => {
    mocks.verificationTokenRepository.findOne.mockResolvedValue(null);

    await expect(authService.confirm('nonexistent-token')).rejects.toThrow(
      InvalidTokenException,
    );
  });

  it('throws TokenExpiredException when token is expired', async () => {
    const rawToken = 'b'.repeat(64);
    const record = buildVerificationToken({
      token_hash: sha256(rawToken),
      type: VerificationTokenType.EMAIL_CONFIRMATION,
      used_at: null,
      expires_at: new Date(Date.now() - 1000),
      user: buildUser({ id: 'u1', is_confirmed: false }),
    });

    mocks.verificationTokenRepository.findOne.mockResolvedValue(record);

    await expect(authService.confirm(rawToken)).rejects.toThrow(
      TokenExpiredException,
    );
  });
});

describe('AuthService — resendConfirmation', () => {
  let authService: AuthService;
  let mocks: AuthMocks;

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('returns silently when email is not found', async () => {
    mocks.usersService.findByEmailWithChannel.mockResolvedValue(null);

    await expect(
      authService.resendConfirmation('unknown@example.com'),
    ).resolves.toBeUndefined();
    expect(mocks.mailService.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('returns silently when user is already confirmed', async () => {
    mocks.usersService.findByEmailWithChannel.mockResolvedValue(
      buildUser({
        id: 'u1',
        is_confirmed: true,
        channel: buildChannel({ name: 'nick' }),
      }),
    );

    await expect(
      authService.resendConfirmation('confirmed@example.com'),
    ).resolves.toBeUndefined();
    expect(mocks.mailService.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('invalidates old tokens and sends a new confirmation email', async () => {
    const user = buildUser({
      id: 'u1',
      email: 'user@example.com',
      is_confirmed: false,
      channel: buildChannel({ name: 'nick' }),
    });
    mocks.usersService.findByEmailWithChannel.mockResolvedValue(user);

    const qbMock = buildQueryBuilderMock();
    mocks.verificationTokenRepository.createQueryBuilder.mockReturnValue(
      qbMock,
    );
    mocks.verificationTokenRepository.create.mockReturnValue(
      buildVerificationToken(),
    );

    await authService.resendConfirmation('user@example.com');

    expect(qbMock.execute).toHaveBeenCalled();
    expect(mocks.verificationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: VerificationTokenType.EMAIL_CONFIRMATION,
        user_id: 'u1',
      }),
    );
    expect(mocks.mailService.sendConfirmationEmail).toHaveBeenCalledWith(
      'user@example.com',
      'nick',
      expect.any(String),
    );
  });
});

describe('AuthService — login', () => {
  let authService: AuthService;
  let mocks: AuthMocks;
  let hashedTestPassword: string;

  beforeAll(async () => {
    hashedTestPassword = await argon2.hash('correctpassword');
  });

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('throws InvalidCredentialsException when email is not found', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(null);

    await expect(
      authService.login({
        email: 'nobody@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(InvalidCredentialsException);
  });

  it('throws InvalidCredentialsException when password is wrong', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'user@example.com',
        password: hashedTestPassword,
        is_confirmed: true,
      }),
    );

    await expect(
      authService.login({
        email: 'user@example.com',
        password: 'wrongpassword',
      }),
    ).rejects.toThrow(InvalidCredentialsException);
  });

  it('throws EmailNotConfirmedException when user is not confirmed', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'user@example.com',
        password: hashedTestPassword,
        is_confirmed: false,
      }),
    );

    await expect(
      authService.login({
        email: 'user@example.com',
        password: 'correctpassword',
      }),
    ).rejects.toThrow(EmailNotConfirmedException);
  });

  it('returns access_token and refresh_token on valid credentials', async () => {
    mocks.usersService.findByEmail.mockResolvedValue(
      buildUser({
        id: 'u1',
        email: 'user@example.com',
        password: hashedTestPassword,
        is_confirmed: true,
      }),
    );

    const result = await authService.login({
      email: 'user@example.com',
      password: 'correctpassword',
    });

    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(typeof result.access_token).toBe('string');
    expect(typeof result.refresh_token).toBe('string');
    expect(mocks.refreshTokenRepository.save).toHaveBeenCalled();
  });
});

describe('AuthService — refresh', () => {
  let authService: AuthService;
  let mocks: AuthMocks;

  const mockUser = buildUser({ id: 'u1', email: 'user@example.com' });
  const rawToken = 'a'.repeat(64);
  const tokenHash = sha256(rawToken);

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('throws InvalidTokenException when token is not found', async () => {
    mocks.refreshTokenRepository.findOne.mockResolvedValue(null);

    await expect(authService.refresh(rawToken)).rejects.toThrow(
      InvalidTokenException,
    );
  });

  it('throws TokenExpiredException when token is expired', async () => {
    const record = buildRefreshToken({
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() - 1000),
      revoked_at: null,
    });
    mocks.refreshTokenRepository.findOne.mockResolvedValue(record);

    await expect(authService.refresh(rawToken)).rejects.toThrow(
      TokenExpiredException,
    );
  });

  it('rotates token: revokes old, persists new, returns both tokens', async () => {
    const record = buildRefreshToken({
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    });
    mocks.refreshTokenRepository.findOne.mockResolvedValue(record);
    mocks.refreshTokenRepository.create.mockReturnValue(buildRefreshToken());

    const result = await authService.refresh(rawToken);

    expect(record.revoked_at).toBeInstanceOf(Date);
    expect(mocks.refreshTokenRepository.save).toHaveBeenCalledWith(record);
    expect(mocks.refreshTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ family: 'family-uuid', user_id: 'u1' }),
    );
    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(result.refresh_token).not.toBe(rawToken);
  });

  it('returns new access token without revoking family when reuse is within grace period', async () => {
    const revokedAt = new Date(Date.now() - 5_000);
    const record = buildRefreshToken({
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: revokedAt,
    });
    mocks.refreshTokenRepository.findOne.mockResolvedValue(record);

    const result = await authService.refresh(rawToken);

    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBe(rawToken);
    expect(
      mocks.refreshTokenRepository.createQueryBuilder,
    ).not.toHaveBeenCalled();
  });

  it('revokes entire family and throws TokenReuseDetectedException beyond grace period', async () => {
    const revokedAt = new Date(Date.now() - 15_000);
    const record = buildRefreshToken({
      token_hash: tokenHash,
      family: 'family-uuid',
      user_id: 'u1',
      user: mockUser,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: revokedAt,
    });
    mocks.refreshTokenRepository.findOne.mockResolvedValue(record);

    const qbMock = buildQueryBuilderMock();
    mocks.refreshTokenRepository.createQueryBuilder.mockReturnValue(qbMock);

    await expect(authService.refresh(rawToken)).rejects.toThrow(
      TokenReuseDetectedException,
    );

    expect(qbMock.execute).toHaveBeenCalled();
    expect(qbMock.where).toHaveBeenCalledWith('family = :family', {
      family: 'family-uuid',
    });
  });
});

describe('AuthService — logout', () => {
  let authService: AuthService;
  let mocks: AuthMocks;

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('revokes all active refresh tokens for the user', async () => {
    const qbMock = buildQueryBuilderMock();
    mocks.refreshTokenRepository.createQueryBuilder.mockReturnValue(qbMock);

    await authService.logout('user-id-123');

    // `expect.any` is declared as returning `any`; annotate so the expected
    // payload stays typed.
    expect(qbMock.set).toHaveBeenCalledWith({
      revoked_at: expect.any(Date) as Date,
    });
    expect(qbMock.where).toHaveBeenCalledWith('user_id = :userId', {
      userId: 'user-id-123',
    });
    expect(qbMock.andWhere).toHaveBeenCalledWith('revoked_at IS NULL');
    expect(qbMock.execute).toHaveBeenCalled();
  });
});

describe('AuthService — forgotPassword', () => {
  let authService: AuthService;
  let mocks: AuthMocks;

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('returns silently when email is not registered', async () => {
    mocks.usersService.findByEmailWithChannel.mockResolvedValue(null);

    await expect(
      authService.forgotPassword('unknown@example.com'),
    ).resolves.toBeUndefined();
    expect(mocks.mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('invalidates previous reset tokens and sends a reset email', async () => {
    const user = buildUser({
      id: 'u1',
      email: 'user@example.com',
      channel: buildChannel({ name: 'nick' }),
    });
    mocks.usersService.findByEmailWithChannel.mockResolvedValue(user);

    const qbMock = buildQueryBuilderMock();
    mocks.verificationTokenRepository.createQueryBuilder.mockReturnValue(
      qbMock,
    );
    mocks.verificationTokenRepository.create.mockReturnValue(
      buildVerificationToken(),
    );

    await authService.forgotPassword('user@example.com');

    expect(qbMock.execute).toHaveBeenCalled();
    expect(qbMock.andWhere).toHaveBeenCalledWith('type = :type', {
      type: VerificationTokenType.PASSWORD_RESET,
    });
    expect(mocks.verificationTokenRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: VerificationTokenType.PASSWORD_RESET,
        user_id: 'u1',
      }),
    );
    expect(mocks.mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'user@example.com',
      'nick',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });
});

describe('AuthService — resetPassword', () => {
  let authService: AuthService;
  let mocks: AuthMocks;

  beforeEach(async () => {
    mocks = buildMocks();
    const module = await buildTestModule(mocks);
    authService = module.get(AuthService);
  });

  it('throws InvalidTokenException when token is not found', async () => {
    mocks.verificationTokenRepository.findOne.mockResolvedValue(null);

    await expect(
      authService.resetPassword('badtoken', 'newpassword'),
    ).rejects.toThrow(InvalidTokenException);
  });

  it('throws TokenExpiredException when token is expired', async () => {
    const rawToken = 'c'.repeat(64);
    const record = buildVerificationToken({
      token_hash: sha256(rawToken),
      type: VerificationTokenType.PASSWORD_RESET,
      used_at: null,
      expires_at: new Date(Date.now() - 1000),
      user: buildUser({ id: 'u1', password: 'oldhash' }),
    });
    mocks.verificationTokenRepository.findOne.mockResolvedValue(record);

    await expect(
      authService.resetPassword(rawToken, 'newpassword'),
    ).rejects.toThrow(TokenExpiredException);
  });

  it('hashes the new password, marks token used, and revokes refresh tokens', async () => {
    const rawToken = 'd'.repeat(64);
    const user = buildUser({ id: 'u1', password: 'oldhash' });
    const record = buildVerificationToken({
      token_hash: sha256(rawToken),
      type: VerificationTokenType.PASSWORD_RESET,
      used_at: null,
      expires_at: new Date(Date.now() + 60_000),
      user,
    });
    mocks.verificationTokenRepository.findOne.mockResolvedValue(record);

    const qbMock = buildQueryBuilderMock();
    mocks.refreshTokenRepository.createQueryBuilder.mockReturnValue(qbMock);

    await authService.resetPassword(rawToken, 'newplaintext');

    expect(record.used_at).toBeInstanceOf(Date);
    expect(user.password).not.toBe('oldhash');
    expect(user.password).toMatch(/^\$argon2/);
    expect(mocks.verificationTokenRepository.save).toHaveBeenCalledWith(record);
    expect(mocks.usersService.save).toHaveBeenCalledWith(user);
    expect(qbMock.where).toHaveBeenCalledWith('user_id = :userId', {
      userId: 'u1',
    });
    expect(qbMock.execute).toHaveBeenCalled();
  });
});
