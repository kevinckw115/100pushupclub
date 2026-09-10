import { useState } from 'react';
import { View } from 'react-native';
import Today from '../../app/(tabs)/today';
import { Button } from '../components/ui';
import { LoadingStorage, useLocal } from '../services/local-context';

export default function StorageFailureReview() {
  const { repo, partition } = useLocal();
  const [armed, setArmed] = useState(false);
  if (!repo || !partition) return <LoadingStorage />;
  return <View style={{ flex: 1 }}>
    <Button label={armed ? 'Disarm test storage failure' : 'Arm test storage failure'} onPress={() => {
      if (armed) repo.db.exec('DROP TRIGGER IF EXISTS test_write_failure;');
      else repo.db.exec("CREATE TRIGGER test_write_failure BEFORE INSERT ON local_checkins BEGIN SELECT RAISE(ABORT,'test write failure'); END;");
      setArmed(!armed);
    }} />
    <Today />
  </View>;
}
