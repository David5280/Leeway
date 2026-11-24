// First-run setup in seven steps: setup code, sign-in, period, bank sync, an
// optional paystub, categories, done.

import { useState } from 'react'
import type { ApiError, Status } from '../api/client'
import { AccountStep } from './setup/AccountStep'
import { BanksStep } from './setup/BanksStep'
import { CodeStep } from './setup/CodeStep'
import { DoneStep } from './setup/DoneStep'
import { PaystubStep } from './setup/PaystubStep'
import { PeriodStep } from './setup/PeriodStep'
import { StartStep } from './setup/StartStep'

/**
 * First run. Steps 1 and 2 make the owner account and sign in; the rest runs
 * signed in, saving as it goes, so a reload picks up where it left off.
 */
export function Setup({ status, signedIn = false }: { status: Status; signedIn?: boolean }) {
  if (!signedIn) return <SignUp status={status} />
  return <SignedInSetup status={status} />
}

/** The setup code, then the sign-in. The code is kept here so Back does not lose it. */
function SignUp({ status }: { status: Status }) {
  const [code, setCode] = useState('')
  const [checked, setChecked] = useState(false)
  const [rejected, setRejected] = useState<ApiError | null>(null)

  if (!checked) {
    return (
      <CodeStep
        status={status}
        code={code}
        rejected={rejected}
        onChange={(typed) => {
          setCode(typed)
          setRejected(null)
        }}
        onNext={() => setChecked(true)}
      />
    )
  }
  return (
    <AccountStep
      setupCode={code}
      onBack={() => setChecked(false)}
      onCodeRejected={(error) => {
        setRejected(error)
        setChecked(false)
      }}
    />
  )
}

function SignedInSetup({ status }: { status: Status }) {
  const [step, setStep] = useState(3)
  const back = () => setStep((s) => s - 1)
  const next = () => setStep((s) => s + 1)
  if (step === 3) return <PeriodStep onNext={next} />
  if (step === 4) return <BanksStep status={status} onBack={back} onNext={next} />
  if (step === 5) return <PaystubStep onBack={back} onNext={next} />
  if (step === 6) return <StartStep onBack={back} onNext={next} />
  return <DoneStep status={status} />
}
