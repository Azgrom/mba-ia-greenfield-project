import { ApiProperty } from '@nestjs/swagger';

export class PresignedPartDto {
  @ApiProperty({ type: 'number', description: 'Part number (1-indexed)' })
  partNumber: number;

  @ApiProperty({
    type: 'string',
    description: 'Presigned URL for uploading this part',
  })
  url: string;
}

export class InitiateUploadResponseDto {
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'Unique ID of the video',
  })
  id: string;

  @ApiProperty({
    type: 'string',
    description: 'Unique, collision-safe slug for the video',
  })
  slug: string;

  @ApiProperty({
    type: 'string',
    description: 'S3/MinIO multipart upload ID',
  })
  uploadId: string;

  @ApiProperty({
    type: 'array',
    items: { $ref: '#/components/schemas/PresignedPartDto' },
    description:
      'Array of presigned part URLs (one per part, sized from fileSizeBytes)',
  })
  parts: PresignedPartDto[];
}
