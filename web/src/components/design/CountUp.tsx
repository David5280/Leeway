// An amount that counts up to its value when it first shows or changes, for a
// screen's hero figure. Screen readers hear only the final amount; the moving
// copy is hidden from them. With less motion asked for, it is just <Money>.

import { useCountUp } from '../../lib/motion'
import { Money, type MoneyProps } from './Money'

export function CountUp({ cents, ...money }: MoneyProps) {
  const shown = useCountUp(cents)
  if (shown === cents) return <Money cents={cents} {...money} />
  return (
    <span className="count-up">
      <span className="visually-hidden">
        <Money cents={cents} {...money} />
      </span>
      <span aria-hidden="true">
        <Money cents={shown} {...money} />
      </span>
    </span>
  )
}
