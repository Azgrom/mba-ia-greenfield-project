import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import appConfig from '../config/app.config';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import { envValidationSchema } from '../config/env.validation';
import { Video } from '../videos/entities/video.entity';
import { StorageModule } from '../storage/storage.module';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VIDEO_PROCESSING_QUEUE } from '../queue/video-queue.constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, storageConfig, queueConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video]),
    BullModule.forRootAsync({
      imports: [ConfigModule.forFeature(queueConfig)],
      inject: [queueConfig.KEY],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: cfg.redisHost,
          port: cfg.redisPort,
        },
      }),
    }),
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
    }),
    StorageModule,
  ],
  providers: [VideoProcessingProcessor],
})
export class VideoWorkerModule {}
