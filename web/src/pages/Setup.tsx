// First-run setup in five steps: account, period, banks, starting point, done.

import { useState } from 'react'
import type { Status } from '../api/client'
import { AccountStep } from './setup/AccountStep'
import { BanksStep } from './setup/BanksStep'
import { DoneStep } from './setup/DoneStep'
import { PeriodStep } from './setup/PeriodStep'
import { StartStep } from './setup/StartStep'

/**
 * First run. Step 1 makes the owner account and signs in; the rest runs
 * signed in, saving as it goes, so a reload picks up where it left off.
 */
export function Setup({ status, startAt = 1 }: { status: Status; startAt?: 1 | 2 }) {
  if (startAt === 1) return <AccountStep />
  return <SignedInSetup status={status} />
}

function SignedInSetup({ status }: { status: Status }) {
  const [step, setStep] = useState(2)
  const back = () => setStep((s) => s - 1)
  const next = () => setStep((s) => s + 1)
  if (step === 2) return <PeriodStep onNext={next} />
  if (step === 3) return <BanksStep status={status} onBack={back} onNext={next} />
  if (step === 4) return <StartStep onBack={back} onNext={next} />
  return <DoneStep status={status} />
}
