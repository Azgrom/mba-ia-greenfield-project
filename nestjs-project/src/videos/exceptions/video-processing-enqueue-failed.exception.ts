import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoProcessingEnqueueFailedException extends DomainException {
  constructor() {
    super(
      'VIDEO_PROCESSING_ENQUEUE_FAILED',
      502,
      'Failed to enqueue video for processing',
    );
  }
}
