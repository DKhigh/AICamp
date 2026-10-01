// 입력자 이름 입력칸. 저장하는 화면(발주·차질·대체 발주)에서 직접 적고, 공백이면 저장할 수 없다.
// 한 번 적은 이름은 이 브라우저에 기억해 두고 다음 입력 때 미리 채운다.
import { CREATOR_REQUIRED_MESSAGE } from '../lib/api';
import { useAppData } from '../state/AppData';
import { Field, INPUT_CLASS } from './ui';

export function CreatorField({ touched = true }: { touched?: boolean }) {
  const { userName, setUserName, createdBy } = useAppData();
  return (
    <Field label="입력자 (필수)" error={touched && !createdBy ? CREATOR_REQUIRED_MESSAGE : null}>
      <input
        className={INPUT_CLASS}
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        placeholder="이름"
        maxLength={20}
        aria-required="true"
      />
    </Field>
  );
}
