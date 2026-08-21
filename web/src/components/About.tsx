/**
 * About and privacy.
 *
 * Placeholder copy that the user intends to rewrite. Keep the STRUCTURE if the
 * words change: the privacy half has to keep saying what is collected, what is
 * not, and how to delete it, because that is the part doing actual work.
 */

export function About() {
  return (
    <div className="about">
      <section className="about-block">
        <h1 className="about-h1">About Bluebank</h1>
        <p className="about-lead">
          A practice tool for the official College Board question bank, with
          instant marking and the official explanation for every answer choice.
        </p>
      </section>

      <section className="about-block">
        <h2 className="about-h2">How it works</h2>
        <dl className="about-list">
          <div>
            <dt>The questions come from College Board</dt>
            <dd>
              Bluebank does not write questions. It reads the public question
              bank directly from your browser and shows it in a cleaner
              interface. Nothing is stored on a server in between.
            </dd>
          </div>
          <div>
            <dt>Marking is instant, with reasons</dt>
            <dd>
              Every multiple-choice question carries College Board's own
              explanation of why each choice is right or wrong, not just which
              one was correct.
            </dd>
          </div>
          <div>
            <dt>Everything lives in your browser</dt>
            <dd>
              Questions you open are cached locally so the app is fast and works
              offline. Your answers, highlights and flags are stored on your own
              device by default.
            </dd>
          </div>
          <div>
            <dt>Practice sets are stably ordered</dt>
            <dd>
              The same filters always produce the same order, so question 40 is
              the same question tomorrow and on another machine.
            </dd>
          </div>
        </dl>
      </section>

      <section className="about-block">
        <h2 className="about-h2">Privacy</h2>
        <p className="about-lead">
          The short version: no account is needed, and if you make one we still
          do not learn who you are.
        </p>

        <dl className="about-list">
          <div>
            <dt>Without an account</dt>
            <dd>
              Nothing about you is sent anywhere, and no server of ours is
              involved at all. There are no analytics, no tracking and no cookies
              from us. Google's sign-in code is not even downloaded unless you
              ask to sign in.
            </dd>
          </div>
          <div>
            <dt>What your browser does contact</dt>
            <dd>
              College Board, to fetch the questions themselves, and Google Fonts
              for the typeface. Both see your IP address the way any website you
              visit does. Neither is told anything about you, and neither is
              involved in storing your progress.
            </dd>
          </div>
          <div>
            <dt>What we store if you do sign in</dt>
            <dd>
              Which questions you answered and what you answered, how long each
              took, which questions you flagged, and your highlights and notes.
              That is the data that syncs between your devices.
            </dd>
          </div>
          <div>
            <dt>What we never store</dt>
            <dd>
              <strong>Your email address, your name and your profile picture.</strong>
              {' '}Your progress is attached to an anonymous id that Google gives
              us, which is meaningless outside this app. We cannot contact you and
              we cannot tell who you are.
            </dd>
          </div>
          <div>
            <dt>Deleting it</dt>
            <dd>
              The sync panel on the You page has a delete button. It erases
              everything held for your account. Your practice history on your own
              device is kept, because that was always yours.
            </dd>
          </div>
          <div>
            <dt>Who else sees it</dt>
            <dd>
              Nobody. It is not sold, shared, or used to train anything.
            </dd>
          </div>
        </dl>
      </section>

      <section className="about-block">
        <h2 className="about-h2">Fine print</h2>
        <p className="about-p">
          Bluebank is a free, non-commercial personal project. It is not
          affiliated with, endorsed by, or connected to the College Board. SAT is
          a trademark registered by the College Board, which is not affiliated
          with and does not endorse this tool.
        </p>
      </section>
    </div>
  )
}
