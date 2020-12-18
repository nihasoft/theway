import { ApplicationException } from './application.exception';
import { Messages } from '../shared/messages';

export class NotAllowedException extends ApplicationException {
    constructor(message: string) {
        super(message, Messages.getMessage('not-allowed'), Messages.getCodeMessage('not-allowed-code'));
    }
}
