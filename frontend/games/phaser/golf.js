registerGame("golf", "⛳ Mini Golf", "Click to set direction, hold for power", "Fewest strokes to the hole wins", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a3a1a");
    // Course
    this.add.rectangle(W/2,H/2,W-60,H-60,0x2a5a2a).setStrokeStyle(2,0x448844);
    // Walls
    this.walls=this.physics.add.staticGroup();
    [[W/2,32,W-60,4],[W/2,H-32,W-60,4],[32,H/2,4,H-60],[W-32,H/2,4,H-60],
     [300,200,120,10],[500,350,10,120],[200,380,100,10]].forEach(([x,y,w,h])=>
      this.walls.add(this.add.rectangle(x,y,w,h,0x448844)));
    // Hole
    this.hole=this.add.circle(W-100,100,12,0x000000);this.add.circle(W-100,100,12).setStrokeStyle(2,0xffffff);
    // Ball
    this.ball=this.add.circle(100,H-100,8,0xffffff);this.physics.add.existing(this.ball);
    this.ball.body.setDrag(80).setBounce(0.7).setCollideWorldBounds(true);
    this.physics.add.collider(this.ball,this.walls);
    this.strokes=0;this.aiming=false;this.power=0;
    this.sTxt=this.add.text(W/2,16,"Strokes: 0 — Click ball to aim, hold for power",{fontSize:"14px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.line=this.add.graphics();
    this.input.on("pointerdown",(ptr)=>{if(this.ball.body.speed<5){this.aiming=true;this.power=0;}});
    this.input.on("pointerup",(ptr)=>{
      if(!this.aiming)return;this.aiming=false;this.line.clear();
      const angle=Phaser.Math.Angle.Between(this.ball.x,this.ball.y,ptr.x,ptr.y);
      const spd=Math.min(this.power*4,500);
      this.ball.body.setVelocity(Math.cos(angle)*spd,Math.sin(angle)*spd);
      this.strokes++;this.sTxt.setText("Strokes: "+this.strokes);
    });
  }
  update(){
    if(this.aiming){this.power=Math.min(this.power+1.5,120);
      this.line.clear();this.line.lineStyle(2,0xf7c948);
      const ptr=this.input.activePointer;
      this.line.lineBetween(this.ball.x,this.ball.y,ptr.x,ptr.y);
    }
    if(Phaser.Math.Distance.Between(this.ball.x,this.ball.y,W-100,100)<14&&this.ball.body.speed<200){
      this.ball.body.setVelocity(0);this.ball.setPosition(W-100,100);
      this.add.text(W/2,H/2,"HOLE IN "+this.strokes+"!",{fontSize:"36px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
    }
  }
});
