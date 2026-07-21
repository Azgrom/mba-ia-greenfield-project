import {
  IsInt,
  Matches,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class InitiateUploadDto {
  /** Title of the video. */
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title: string;

  /** Original filename of the video file. */
  @IsString()
  @IsNotEmpty()
  originalFilename: string;

  /** MIME type of the video file (must start with "video/"). */
  @IsString()
  @Matches(/^video\//, { message: 'mimeType must start with "video/"' })
  mimeType: string;

  /** File size in bytes (1 byte to 10 GiB). */
  @IsInt()
  @Min(1)
  @Max(10737418240)
  fileSizeBytes: number;
}
