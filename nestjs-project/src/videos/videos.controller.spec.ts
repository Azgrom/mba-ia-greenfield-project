import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import type { Response } from 'express';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { VideoNotReadyException } from './exceptions/video-not-ready.exception';

describe('VideosController', () => {
  let controller: VideosController;
  let videosService: VideosService;
  let storageService: StorageService;

  const mockVideo = {
    id: '12345678-1234-5678-1234-567812345678',
    slug: 'test-video',
    status: VideoStatus.READY,
    storage_key: 'videos/test-video.mp4',
    mime_type: 'video/mp4',
  } as Video;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [
        {
          provide: VideosService,
          useValue: {
            findBySlugOrFail: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            getObjectRange: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Channel),
          useValue: {
            findOneBy: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get<VideosController>(VideosController);
    videosService = moduleRef.get<VideosService>(VideosService);
    storageService = moduleRef.get<StorageService>(StorageService);
  });

  describe('stream', () => {
    it('should stream video with proper headers', async () => {
      // Arrange
      const mockBody = new Readable({
        read() {},
      });

      const findBySlugSpy = jest
        .spyOn(videosService, 'findBySlugOrFail')
        .mockResolvedValue(mockVideo);
      const getObjectRangeSpy = jest
        .spyOn(storageService, 'getObjectRange')
        .mockResolvedValue({
          body: mockBody,
          contentLength: 1000,
          contentRange: undefined,
          statusCode: 200,
        });

      const mockRes: Partial<Response> = {
        status: jest.fn().mockReturnThis() as never,
        set: jest.fn().mockReturnThis() as never,
        headersSent: false,
        end: jest.fn(),
        destroy: jest.fn(),
      };

      const pipeSpy = jest.spyOn(mockBody, 'pipe');
      pipeSpy.mockReturnValue(mockRes as never);

      // Act
      await controller.stream('test-video', undefined, mockRes as Response);

      // Assert
      expect(findBySlugSpy).toHaveBeenCalledWith('test-video');
      expect(getObjectRangeSpy).toHaveBeenCalledWith(
        'videos/test-video.mp4',
        undefined,
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.set).toHaveBeenCalledWith({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
        'Content-Length': '1000',
      });
      expect(pipeSpy).toHaveBeenCalledWith(mockRes);
    });

    it('should throw VideoNotReadyException when video status is not READY', async () => {
      // Arrange
      const notReadyVideo = { ...mockVideo, status: VideoStatus.PROCESSING };
      jest
        .spyOn(videosService, 'findBySlugOrFail')
        .mockResolvedValue(notReadyVideo);

      const mockRes = {} as Response;

      // Act & Assert
      await expect(
        controller.stream('test-video', undefined, mockRes),
      ).rejects.toThrow(VideoNotReadyException);
    });

    it('should include Content-Range header when range is provided', async () => {
      // Arrange
      const mockBody = new Readable({
        read() {},
      });

      jest
        .spyOn(videosService, 'findBySlugOrFail')
        .mockResolvedValue(mockVideo);
      jest.spyOn(storageService, 'getObjectRange').mockResolvedValue({
        body: mockBody,
        contentLength: 500,
        contentRange: 'bytes 0-499/1000',
        statusCode: 206,
      });

      const mockRes: Partial<Response> = {
        status: jest.fn().mockReturnThis() as never,
        set: jest.fn().mockReturnThis() as never,
        headersSent: false,
        end: jest.fn(),
        destroy: jest.fn(),
      };

      const pipeSpy = jest.spyOn(mockBody, 'pipe');
      pipeSpy.mockReturnValue(mockRes as never);

      // Act
      await controller.stream('test-video', 'bytes=0-499', mockRes as Response);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(206);
      expect(mockRes.set).toHaveBeenCalledWith({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
        'Content-Length': '500',
        'Content-Range': 'bytes 0-499/1000',
      });
    });

    it('should handle stream error before headers are sent', async () => {
      // Arrange
      const mockBody = new Readable({
        read() {},
      });

      jest
        .spyOn(videosService, 'findBySlugOrFail')
        .mockResolvedValue(mockVideo);
      jest.spyOn(storageService, 'getObjectRange').mockResolvedValue({
        body: mockBody,
        contentLength: 1000,
        contentRange: undefined,
        statusCode: 200,
      });

      const mockRes: Partial<Response> = {
        status: jest.fn().mockReturnThis() as never,
        set: jest.fn().mockReturnThis() as never,
        headersSent: false,
        end: jest.fn(),
        destroy: jest.fn(),
      };

      const pipeSpy = jest.spyOn(mockBody, 'pipe');
      pipeSpy.mockReturnValue(mockRes as never);

      // Act
      await controller.stream('test-video', undefined, mockRes as Response);

      // Emit an error on the body stream
      mockBody.emit('error', new Error('Stream error'));

      // Assert - error listener should call status(500).end()
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should handle stream error after headers are sent', async () => {
      // Arrange
      const mockBody = new Readable({
        read() {},
      });

      jest
        .spyOn(videosService, 'findBySlugOrFail')
        .mockResolvedValue(mockVideo);
      jest.spyOn(storageService, 'getObjectRange').mockResolvedValue({
        body: mockBody,
        contentLength: 1000,
        contentRange: undefined,
        statusCode: 200,
      });

      const mockRes: Partial<Response> = {
        status: jest.fn().mockReturnThis() as never,
        set: jest.fn().mockReturnThis() as never,
        headersSent: true, // Headers already sent
        end: jest.fn(),
        destroy: jest.fn(),
      };

      const pipeSpy = jest.spyOn(mockBody, 'pipe');
      pipeSpy.mockReturnValue(mockRes as never);

      // Act
      await controller.stream('test-video', undefined, mockRes as Response);

      // Emit an error on the body stream
      mockBody.emit('error', new Error('Stream error'));

      // Assert - error listener should destroy the response
      expect(mockRes.destroy).toHaveBeenCalled();
      expect(mockRes.end).not.toHaveBeenCalled(); // end should not be called when headers are sent
    });
  });
});
