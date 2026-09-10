import { useState } from 'react';
import { AppScreen, Header, ProgressRing, Copy, Button, BottomSheet, QuantityInput, Row, Notice, TabBar } from '../components/ui';

export default function ComponentGallery() {
  const [total, setTotal] = useState('35');
  const [value, setValue] = useState('10');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('today');
  return <AppScreen footer={<TabBar selected={selected} onSelect={setSelected} />}>
    <Header />
    <Notice>Development component review · illustrative values</Notice>
    <Copy variant="headline" style={{ textAlign: 'center' }}>A little at a time.</Copy>
    <ProgressRing total={total} />
    <Copy style={{ textAlign: 'center' }}>{total === '35' ? '65 to go. Take your time.' : '100 today. Nicely done.'}</Copy>
    <Button label="Review quantity sheet" onPress={() => setOpen(true)} />
    <Button secondary label={total === '35' ? 'Review 100' : 'Review 35'} onPress={() => setTotal(total === '35' ? '100' : '35')} />
    <Row title="Example row" detail="Saved on this phone" />
    <BottomSheet visible={open} title="Quantity controls" onClose={() => setOpen(false)}>
      <QuantityInput value={value} onChange={setValue} />
      <Button label="Close review" onPress={() => setOpen(false)} />
    </BottomSheet>
  </AppScreen>;
}
