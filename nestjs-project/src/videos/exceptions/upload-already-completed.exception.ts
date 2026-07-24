import { DomainException } from '../../common/exceptions/domain.exception';

export class UploadAlreadyCompletedException extends DomainException {
  constructor() {
    super('UPLOAD_ALREADY_COMPLETED', 409, 'Upload has already been completed');
  }
}
