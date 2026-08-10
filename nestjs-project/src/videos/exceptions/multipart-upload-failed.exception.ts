import { DomainException } from '../../common/exceptions/domain.exception';

export class MultipartUploadFailedException extends DomainException {
  constructor() {
    super('MULTIPART_UPLOAD_FAILED', 422, 'Multipart upload failed');
  }
}
