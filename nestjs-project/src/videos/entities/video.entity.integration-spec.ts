import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function createUser(): Promise<User> {
    return userRepository.save(
      userRepository.create({
        email: `vid_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  async function createChannel(user: User): Promise<Channel> {
    return channelRepository.save(
      channelRepository.create({
        name: 'Test Channel',
        nickname: `chan_${user.id.substring(0, 8)}`,
        user_id: user.id,
      }),
    );
  }

  it('should enforce unique slug constraint', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Video 1',
        slug: 'video-slug',
        storage_key: 'path/to/video1.mp4',
        original_filename: 'video1.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000000',
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          title: 'Video 2',
          slug: 'video-slug',
          storage_key: 'path/to/video2.mp4',
          original_filename: 'video2.mp4',
          mime_type: 'video/mp4',
          file_size_bytes: '1000000',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should default status to draft', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Test Video',
        slug: 'test-video',
        storage_key: 'path/to/video.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000000',
      }),
    );

    expect(video.status).toBe(VideoStatus.DRAFT);
  });

  it('should reject status outside valid enum values', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const invalidVideo = videoRepository.create({
      channel_id: channel.id,
      title: 'Test Video',
      slug: 'test-video',
      storage_key: 'path/to/video.mp4',
      original_filename: 'video.mp4',
      mime_type: 'video/mp4',
      file_size_bytes: '1000000',
    });
    invalidVideo.status = 'invalid_status' as unknown as VideoStatus;

    await expect(videoRepository.save(invalidVideo)).rejects.toThrow();
  });

  it('should enforce FK to channels', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: '00000000-0000-0000-0000-000000000000',
          title: 'Test Video',
          slug: 'test-video',
          storage_key: 'path/to/video.mp4',
          original_filename: 'video.mp4',
          mime_type: 'video/mp4',
          file_size_bytes: '1000000',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should allow null thumbnail_key', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Test Video',
        slug: 'test-video',
        thumbnail_key: null,
        storage_key: 'path/to/video.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000000',
      }),
    );

    expect(video.thumbnail_key).toBeNull();
  });

  it('should allow null upload_id', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Test Video',
        slug: 'test-video',
        upload_id: null,
        storage_key: 'path/to/video.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000000',
      }),
    );

    expect(video.upload_id).toBeNull();
  });

  it('should allow null duration_seconds', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Test Video',
        slug: 'test-video',
        duration_seconds: null,
        storage_key: 'path/to/video.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000000',
      }),
    );

    expect(video.duration_seconds).toBeNull();
  });

  it('should allow null metadata', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Test Video',
        slug: 'test-video',
        metadata: null,
        storage_key: 'path/to/video.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000000',
      }),
    );

    expect(video.metadata).toBeNull();
  });

  it('should allow null error_message', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Test Video',
        slug: 'test-video',
        error_message: null,
        storage_key: 'path/to/video.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000000',
      }),
    );

    expect(video.error_message).toBeNull();
  });
});
