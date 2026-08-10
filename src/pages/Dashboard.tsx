import { Link } from "react-router-dom";

function Dashboard() {
  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <Link to="/" className="logo">
          NeuroCode
        </Link>

        <nav>
          <Link to="/courses">Courses</Link>
          <Link to="/profile">Profile</Link>
        </nav>
      </header>

      <main className="dashboard-content">
        <section className="welcome">
          <p className="eyebrow">WELCOME BACK</p>

          <h1>Keep learning.</h1>

          <p>
            Continue where you left off or explore something new.
          </p>
        </section>

        <section className="continue-card">
          <div>
            <p className="eyebrow">CONTINUE LEARNING</p>

            <h2>Java Fundamentals</h2>

            <p>
              You're currently learning about variables and basic data types.
            </p>

            <Link to="/learn" className="primary-button">
              Continue Lesson
            </Link>
          </div>

          <div className="dashboard-progress">
            <strong>0%</strong>

            <div className="large-progress">
              <div></div>
            </div>

            <span>0 of 12 lessons completed</span>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR COURSES</p>
              <h2>Learning paths</h2>
            </div>

            <Link to="/courses">View all</Link>
          </div>

          <div className="course-grid">
            <div className="course-card">
              <span className="course-language">JAVA</span>

              <h3>Java Fundamentals</h3>

              <p>
                Learn the foundations of programming using Java.
              </p>

              <span className="course-status">In progress</span>
            </div>

            <div className="course-card locked">
              <span className="course-language">PYTHON</span>

              <h3>Python Fundamentals</h3>

              <p>
                Build your programming foundation with Python.
              </p>

              <span className="course-status">Coming soon</span>
            </div>

            <div className="course-card locked">
              <span className="course-language">JAVASCRIPT</span>

              <h3>JavaScript Fundamentals</h3>

              <p>
                Learn the language behind modern web development.
              </p>

              <span className="course-status">Coming soon</span>
            </div>
          </div>
        </section>

        <section className="stats-grid">
          <div>
            <span>Lessons completed</span>
            <strong>0</strong>
          </div>

          <div>
            <span>Challenges solved</span>
            <strong>0</strong>
          </div>

          <div>
            <span>Learning streak</span>
            <strong>0 days</strong>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;